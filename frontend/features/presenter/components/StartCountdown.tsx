"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export const START_COUNTDOWN_SECONDS = 3;

/**
 * Optional 3-2-1 before the first slide (W2-A polish). The presenter view
 * counts down on its own stage and in the audience window (through the
 * channel's `ui`), then sends `start`. Phones stay in the lobby meanwhile.
 */
export function useStartCountdown(start: () => Promise<unknown>) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const run = useCallback(() => {
    if (timer.current) return;
    let left = START_COUNTDOWN_SECONDS;
    setSecondsLeft(left);
    timer.current = setInterval(() => {
      left -= 1;
      if (left > 0) {
        setSecondsLeft(left);
        return;
      }
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setSecondsLeft(null);
      void start();
    }, 1000);
  }, [start]);

  return { secondsLeft, running: secondsLeft !== null, run };
}

/** The big number over the stage while the start countdown runs. */
export function CountdownOverlay({ secondsLeft }: { secondsLeft: number | null }) {
  const t = useTranslations("presenter.console");
  if (secondsLeft === null) return null;
  return (
    <div
      role="status"
      aria-live="assertive"
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-deck-stage-bg/90 text-deck-stage-fg"
    >
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-deck-stage-muted">{t("countdown")}</p>
      <p key={secondsLeft} className="font-mono text-[min(30vh,12rem)] font-semibold leading-none tabular-nums text-deck-accent motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in">
        {secondsLeft}
      </p>
    </div>
  );
}
