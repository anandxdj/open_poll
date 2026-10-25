"use client";

import { useEffect, useState } from "react";
import { getApiErrorStatus } from "@/lib/api-error";
import { getSessionReport } from "../api/sessions";
import type { SessionReport } from "../types";

/** How often a live session's report refreshes. */
export const LIVE_REFRESH_MS = 5000;

export interface SessionReportState {
  report: SessionReport | null;
  loading: boolean;
  error: "notFound" | "failed" | null;
  reload: () => void;
  /** Swaps in an updated copy (after sharing changes) without a round trip. */
  setReport: (report: SessionReport) => void;
}

/** The session report; refreshed every few seconds while the session is live. */
export function useSessionReport(sessionId: string): SessionReportState {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; report: SessionReport | null; error: SessionReportState["error"] } | null>(null);
  const key = `${sessionId}#${generation}`;
  const isLive = state?.key === key ? (state.report?.session.isLive ?? false) : false;

  useEffect(() => {
    let cancelled = false;
    getSessionReport(sessionId).then(
      (report) => {
        if (!cancelled) setState({ key, report, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        const status = getApiErrorStatus(err);
        setState({ key, report: null, error: status === 403 || status === 404 ? "notFound" : "failed" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, key]);

  // Live: poll quietly, keeping the last good report on a failed refresh.
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      getSessionReport(sessionId).then(
        (report) => {
          if (!cancelled) setState({ key, report, error: null });
        },
        () => {}
      );
    }, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isLive, sessionId, key]);

  const current = state?.key === key ? state : null;
  return {
    report: current?.report ?? null,
    loading: current === null,
    error: current?.error ?? null,
    reload: () => setGeneration((g) => g + 1),
    setReport: (report) => setState({ key, report, error: null }),
  };
}
