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
        <span className="text-[10px] font-bold uppercase tracking-widest text-deck-muted-fg/50 flex items-center gap-1.5">
          <TimerIcon className="size-3" /> {t("timeLeft")}
        </span>
        <span
          className={`text-2xl font-bold tabular-nums tracking-tight ${
            urgent ? "text-deck-wrong animate-pulse" : "text-deck-primary"
          }`}
        >
          {t("seconds", { seconds: secondsLeft })}
        </span>
      </div>
      <div className="h-2 rounded-full bg-deck-stage-fg/5 border border-deck-stage-fg/10 overflow-hidden">
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
