"use client";

import { useEffect, useState } from "react";

import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import { fetchInsights, type Insights, type RangeDays } from "../insights";

interface Result {
  /** The request this result answers. */
  key: string;
  data: Insights | null;
  error: boolean;
}

/**
 * Workspace insights for the last `days` days. Keeps showing the previous
 * range's data while a new one loads, so switching ranges doesn't blank the page.
 */
export function useInsights(days: RangeDays) {
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${days}:${workspaceId ?? ""}:${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    fetchInsights(days, controller.signal)
      .then((data) => setResult({ key, data, error: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error(error);
        setResult((prev) => ({ key, data: prev?.data ?? null, error: true }));
      });
    return () => controller.abort();
  }, [key, days]);

  const loading = result?.key !== key;
  return {
    status: loading ? ("loading" as const) : result.error ? ("error" as const) : ("ready" as const),
    data: result?.data ?? null,
    retry: () => setAttempt((n) => n + 1),
  };
}
