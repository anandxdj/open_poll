"use client";

import { useEffect, useState } from "react";
import { getApiErrorStatus } from "@/lib/api-error";
import { getPublicResults } from "../api/sessions";
import type { PublicResults } from "../types";

export interface PublicResultsState {
  results: PublicResults | null;
  loading: boolean;
  /** `unavailable`: unknown, disabled or expired link (404); `failed`: anything else. */
  error: "unavailable" | "failed" | null;
  reload: () => void;
}

/** The aggregated results behind a share token. */
export function usePublicResults(token: string): PublicResultsState {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<{ key: string; results: PublicResults | null; error: PublicResultsState["error"] } | null>(null);
  const key = `${token}#${generation}`;

  useEffect(() => {
    let cancelled = false;
    getPublicResults(token).then(
      (results) => {
        if (!cancelled) setState({ key, results, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setState({ key, results: null, error: getApiErrorStatus(err) === 404 ? "unavailable" : "failed" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [token, key]);

  const current = state?.key === key ? state : null;
  return {
    results: current?.results ?? null,
    loading: current === null,
    error: current?.error ?? null,
    reload: () => setGeneration((g) => g + 1),
  };
}
