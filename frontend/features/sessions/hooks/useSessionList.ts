"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiErrorStatus } from "@/lib/api-error";
import { listSessions } from "../api/sessions";
import type { SessionListPage, SessionSummaryItem } from "../types";

export interface SessionListState {
  title: string | null;
  items: SessionSummaryItem[];
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  /** `notFound` for 403/404 (no such deck, or not yours); `failed` for anything else. */
  error: "notFound" | "failed" | null;
  loadMore: () => void;
  reload: () => void;
}

const errorKind = (err: unknown): "notFound" | "failed" => {
  const status = getApiErrorStatus(err);
  return status === 403 || status === 404 ? "notFound" : "failed";
};

/** A deck's sessions, newest first; the first page on mount, more on demand. */
export function useSessionList(presentationId: string): SessionListState {
  const [generation, setGeneration] = useState(0);
  const [page, setPage] = useState<{ key: string; data: SessionListPage | null; error: SessionListState["error"] } | null>(null);
  const [extra, setExtra] = useState<{ key: string; items: SessionSummaryItem[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);
  const key = `${presentationId}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    listSessions(presentationId).then(
      (data) => {
        if (!cancelled) setPage({ key, data, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setPage({ key, data: null, error: errorKind(err) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [presentationId, key]);

  const current = page?.key === key ? page : null;
  const more = extra?.key === key ? extra : null;
  const cursor = more ? more.cursor : (current?.data?.nextCursor ?? null);

  const loadMore = useCallback(() => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    listSessions(presentationId, cursor)
      .then((data) => {
        setExtra((prev) => ({
          key,
          items: [...(prev?.key === key ? prev.items : []), ...data.items],
          cursor: data.nextCursor,
        }));
      })
      .catch(() => {
        // Keep what is shown; the button stays so the user can retry.
      })
      .finally(() => {
        busy.current = false;
        setLoadingMore(false);
      });
  }, [cursor, presentationId, key]);

  return {
    title: current?.data?.presentation.title ?? null,
    items: [...(current?.data?.items ?? []), ...(more?.items ?? [])],
    hasMore: cursor !== null,
    loading: current === null,
    loadingMore,
    error: current?.error ?? null,
    loadMore,
    reload: () => {
      setExtra(null);
      setGeneration((g) => g + 1);
    },
  };
}
