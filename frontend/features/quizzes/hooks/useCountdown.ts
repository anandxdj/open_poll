"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Server-synced countdown. `endsAt`/`serverNow` come from the backend so a
 * skewed client clock can't shift the deadline.
 */
export function useCountdown(
  endsAt: string | null | undefined,
  serverNow: string | null | undefined,
  totalSeconds: number
) {
  const [msLeft, setMsLeft] = useState<number>(0);
  // Offset between server clock and local clock, captured when props change
  const offsetRef = useRef(0);

  useEffect(() => {
    if (!endsAt) {
      setMsLeft(0);
      return;
    }
    offsetRef.current = serverNow ? new Date(serverNow).getTime() - Date.now() : 0;

    const tick = () => {
      const nowOnServer = Date.now() + offsetRef.current;
      setMsLeft(Math.max(0, new Date(endsAt).getTime() - nowOnServer));
    };

    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [endsAt, serverNow]);

  const secondsLeft = Math.ceil(msLeft / 1000);
  const progress = totalSeconds > 0 ? Math.min(1, msLeft / (totalSeconds * 1000)) : 0;

  return { msLeft, secondsLeft, progress, expired: !!endsAt && msLeft <= 0 };
}
