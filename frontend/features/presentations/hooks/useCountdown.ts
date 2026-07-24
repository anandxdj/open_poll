"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Server-synced countdown. `endsAt`/`serverNow` come from the backend so a
 * skewed client clock can't shift the deadline.
 */
export function useCountdown(
  endsAt: string | number | null | undefined,
  serverNow: string | null | undefined,
  totalSeconds: number = 30
) {
  const [msLeft, setMsLeft] = useState<number>(0);
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!endsAt) {
      setMsLeft(0);
      return;
    }
    const endMs = typeof endsAt === "number" ? endsAt : new Date(endsAt).getTime();
    offsetRef.current = serverNow ? new Date(serverNow).getTime() - Date.now() : 0;

    const tick = () => {
      const nowOnServer = Date.now() + offsetRef.current;
      setMsLeft(Math.max(0, endMs - nowOnServer));
    };

    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [endsAt, serverNow]);

  const secondsLeft = Math.ceil(msLeft / 1000);
  const progress = totalSeconds > 0 ? Math.min(1, msLeft / (totalSeconds * 1000)) : 0;

  return { msLeft, secondsLeft, progress, expired: !!endsAt && msLeft <= 0 };
}
