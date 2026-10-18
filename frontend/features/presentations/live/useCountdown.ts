"use client";

import { useEffect, useRef, useState } from "react";

type Tick = {
  /** Deadline this tick was measured against. */
  endMs: number;
  /** Server-aligned wall clock at the time of the tick. */
  nowOnServer: number;
};

/**
 * Server-synced countdown. `endsAt`/`serverNow` come from the backend so a
 * skewed client clock can't shift the deadline.
 */
export function useCountdown(
  endsAt: string | number | null | undefined,
  serverNow: string | null | undefined,
  totalSeconds: number = 30
) {
  const endMs = endsAt ? (typeof endsAt === "number" ? endsAt : new Date(endsAt).getTime()) : null;
  const [tick, setTick] = useState<Tick | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (endMs === null) return;

    if (serverNow) {
      offsetRef.current = new Date(serverNow).getTime() - Date.now();
    }

    // The clock is read in the interval callback, never during render.
    const interval = setInterval(() => {
      setTick({ endMs, nowOnServer: Date.now() + offsetRef.current });
    }, 100);

    return () => clearInterval(interval);
  }, [endMs, serverNow]);

  let msLeft = 0;
  if (endMs !== null) {
    if (tick?.endMs === endMs) {
      msLeft = Math.max(0, endMs - tick.nowOnServer);
    } else {
      // No tick for this deadline yet (it just changed, e.g. lobby -> active
      // question). Estimate from the server's own clock, capped at the slide's
      // time budget, so a fresh deadline never reads as an already-expired 0ms.
      const budgetMs = Math.max(0, totalSeconds) * 1000;
      const serverNowMs = serverNow ? new Date(serverNow).getTime() : NaN;
      msLeft = Number.isNaN(serverNowMs)
        ? budgetMs
        : Math.min(budgetMs, Math.max(0, endMs - serverNowMs));
    }
  }

  const secondsLeft = Math.ceil(msLeft / 1000);
  const progress = totalSeconds > 0 ? Math.min(1, msLeft / (totalSeconds * 1000)) : 0;
  const expired = endMs !== null && msLeft <= 0;

  return { msLeft, secondsLeft, progress, expired };
}
