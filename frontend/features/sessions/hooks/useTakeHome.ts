"use client";

import { useEffect, useState } from "react";
import { getParticipantState, getPresentationByCode } from "@/features/presentations/api/participant";
import { getApiErrorStatus } from "@/lib/api-error";
import { getTakeHome } from "../api/sessions";
import { readSummaryCredentials, type SummaryCredentials } from "../credentials";
import type { TakeHome } from "../types";

export type TakeHomeStatus = "loading" | "ready" | "noCredentials" | "notFound" | "removed" | "failed";

export interface TakeHomeState {
  status: TakeHomeStatus;
  data: TakeHome | null;
  reload: () => void;
}

/** How often a running session's take-home refreshes. */
export const TAKE_HOME_REFRESH_MS = 8000;

/** Resolves the session of a legacy per-code entry (stored before sessions had ids). */
async function resolveSessionId(code: string, credentials: SummaryCredentials): Promise<string | null> {
  const info = await getPresentationByCode(code);
  const presentationId = info.presentationId ?? info.quizId;
  if (!presentationId) return null;
  const me = (await getParticipantState(presentationId, credentials.participantId, credentials.token)) as {
    sessionId?: string;
  };
  return me.sessionId ?? null;
}

/**
 * A participant's own results: credentials from this browser's storage, the
 * session from `?sid=` (or the newest stored one), refreshed while it runs.
 */
export function useTakeHome(code: string, sid?: string | null): TakeHomeState {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; status: TakeHomeStatus; data: TakeHome | null } | null>(null);
  const key = `${code}|${sid ?? ""}#${generation}`;
  const resolvedSession = state?.key === key ? state.data?.session : undefined;
  const live = resolvedSession !== undefined && resolvedSession.status !== "ended";
  const resolvedSessionId = resolvedSession?.sessionId;

  useEffect(() => {
    let cancelled = false;
    const finish = (status: TakeHomeStatus, data: TakeHome | null = null) => {
      if (!cancelled) setState({ key, status, data });
    };

    async function load() {
      const credentials = readSummaryCredentials(window.localStorage, code, sid);
      if (!credentials) return finish("noCredentials");
      try {
        const sessionId = credentials.sessionId ?? (await resolveSessionId(code, credentials));
        if (!sessionId) return finish("notFound");
        finish("ready", await getTakeHome(sessionId, credentials.participantId, credentials.token));
      } catch (err: unknown) {
        const status = getApiErrorStatus(err);
        if (status === 403) finish("removed");
        else if (status === 401 || status === 404) finish("notFound");
        else finish("failed");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [code, sid, key]);

  // While the session runs, refresh quietly so results appear as slides close.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      const credentials = readSummaryCredentials(window.localStorage, code, sid);
      if (!credentials || !resolvedSessionId) return;
      getTakeHome(resolvedSessionId, credentials.participantId, credentials.token).then(
        (data) => {
          if (!cancelled) setState({ key, status: "ready", data });
        },
        () => {}
      );
    }, TAKE_HOME_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, resolvedSessionId, code, sid, key]);

  const current = state?.key === key ? state : null;
  return {
    status: current?.status ?? "loading",
    data: current?.data ?? null,
    reload: () => setGeneration((g) => g + 1),
  };
}
