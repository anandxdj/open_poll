"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Server-synced countdown. `endsAt`/`serverNow` come from the backend so a
 * skewed client clock can't shift the deadline.
 */
export function useCountdown(
  endsAt: string | number | null | undefined,
  serverNow: string | null | undefined,
  totalSeconds: number
) {
  const [, setTickState] = useState(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!endsAt) return;

    if (serverNow) {
      offsetRef.current = new Date(serverNow).getTime() - Date.now();
    }

    const interval = setInterval(() => {
      setTickState((t) => t + 1);
    }, 100);

    return () => clearInterval(interval);
  }, [endsAt, serverNow]);

  // Compute msLeft synchronously on every render so state transitions
  // (e.g. lobby -> active question) never calculate a stale 0ms deadline.
  let msLeft = 0;
  if (endsAt) {
    const endMs = typeof endsAt === "number" ? endsAt : new Date(endsAt).getTime();
    const nowOnServer = Date.now() + offsetRef.current;
    msLeft = Math.max(0, endMs - nowOnServer);
  }

  const secondsLeft = Math.ceil(msLeft / 1000);
  const progress = totalSeconds > 0 ? Math.min(1, msLeft / (totalSeconds * 1000)) : 0;
  const expired = !!endsAt && msLeft <= 0;

  return { msLeft, secondsLeft, progress, expired };
}
