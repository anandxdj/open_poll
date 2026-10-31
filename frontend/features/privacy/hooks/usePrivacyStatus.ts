"use client";

import { useCallback, useEffect, useState } from "react";
import { getPrivacyStatus } from "../api/privacy.api";
import type { PrivacyStatus } from "../types";

interface Loaded {
  attempt: number;
  status: PrivacyStatus | null;
}

/** GET /api/me/privacy. `refresh` re-reads quietly, keeping what is shown. */
export function usePrivacyStatus() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPrivacyStatus().then(
      (status) => !cancelled && setLoaded({ attempt, status }),
      () => !cancelled && setLoaded({ attempt, status: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const refresh = useCallback(async () => {
    try {
      const status = await getPrivacyStatus();
      setLoaded((prev) => ({ attempt: prev?.attempt ?? 0, status }));
    } catch {
      // Keep what is shown; the next action reports its own error.
    }
  }, []);

  const current = loaded?.attempt === attempt ? loaded : null;
  return {
    status: current?.status ?? null,
    loading: current === null,
    failed: current !== null && current.status === null,
    retry: () => setAttempt((n) => n + 1),
    refresh,
  };
}
