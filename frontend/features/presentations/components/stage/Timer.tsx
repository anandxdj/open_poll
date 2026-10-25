"use client";

import { Timer as TimerIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface TimerProps {
  secondsLeft: number;
  progress: number; // 1 → full time remaining, 0 → expired
}

/** Countdown bar for an open answer window — stage and participant. */
export function Timer({ secondsLeft, progress }: TimerProps) {
  const t = useTranslations("live.timer");
  const urgent = progress <= 0.25;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm text-deck-muted-fg">
          <TimerIcon className="size-4" /> {t("timeLeft")}
        </span>
        <span
          className={`font-mono text-2xl font-semibold tabular-nums ${
            urgent ? "text-deck-wrong motion-safe:animate-pulse" : "text-deck-fg"
          }`}
        >
          {t("seconds", { seconds: secondsLeft })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-deck-secondary">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
            urgent ? "bg-deck-wrong" : "bg-deck-primary"
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
