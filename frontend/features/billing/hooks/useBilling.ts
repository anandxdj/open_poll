"use client";

import { useCallback, useEffect, useState } from "react";
import { getBilling } from "../api/billing.api";
import type { BillingOverview } from "../types";

interface Loaded {
  workspaceId: string;
  overview: BillingOverview | null;
}

/**
 * The current workspace's billing (GET /api/billing). Waits for the workspace
 * (the request then carries X-Workspace-Id); `workspaceId` null = not allowed
 * or not known yet, so nothing is requested.
 */
export function useBilling(workspaceId: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    getBilling().then(
      (overview) => {
        if (!cancelled) setLoaded({ workspaceId, overview });
      },
      () => {
        if (!cancelled) setLoaded({ workspaceId, overview: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, attempt]);

  const current = loaded && loaded.workspaceId === workspaceId ? loaded : null;

  /** Starts over from the loading state (after a failure). */
  const reload = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);

  /** Re-reads quietly, keeping what is shown; resolves with the fresh overview or null. */
  const refresh = useCallback(async () => {
    if (!workspaceId) return null;
    try {
      const overview = await getBilling();
      setLoaded({ workspaceId, overview });
      return overview;
    } catch {
      return null;
    }
  }, [workspaceId]);

  return {
    overview: current?.overview ?? null,
    loading: workspaceId !== null && current === null,
    failed: current !== null && current.overview === null,
    reload,
    refresh,
  };
}
