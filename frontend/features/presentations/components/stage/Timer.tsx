"use client";

import { Pause, Timer as TimerIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface TimerProps {
  secondsLeft: number;
  progress: number; // 1 → full time remaining, 0 → expired
  /** The host paused the timer: the value is frozen and labelled "Paused". */
  paused?: boolean;
  /**
   * `audience` (default): the phone, which follows the app's light or dark theme.
   * `stage`: the projected stage, which is always dark (`--deck-stage-*` tokens).
   */
  tone?: "audience" | "stage";
}

const TONES = {
  audience: {
    label: "text-deck-muted-fg",
    strong: "text-deck-fg",
    track: "bg-deck-secondary",
    fill: "bg-deck-primary",
    pausedFill: "bg-deck-muted-fg",
  },
  stage: {
    label: "text-deck-stage-fg/60",
    strong: "text-deck-stage-fg",
    track: "bg-deck-stage-fg/10",
    fill: "bg-deck-accent",
    pausedFill: "bg-deck-stage-fg/40",
  },
} as const;

/** Countdown bar for an open answer window — stage and participant. */
export function Timer({ secondsLeft, progress, paused = false, tone = "audience" }: TimerProps) {
  const t = useTranslations("live.timer");
  const colors = TONES[tone];
  const urgent = !paused && progress <= 0.25;

  return (
    <div className="space-y-2" data-testid="countdown" data-paused={paused || undefined}>
      <div className="flex items-center justify-between">
        {paused ? (
          <span role="status" className={`flex items-center gap-1.5 text-sm font-semibold ${colors.strong}`}>
            <Pause className="size-4" /> {t("paused")}
          </span>
        ) : (
          <span className={`flex items-center gap-1.5 text-sm ${colors.label}`}>
            <TimerIcon className="size-4" /> {t("timeLeft")}
          </span>
        )}
        <span
          className={`font-mono text-2xl font-semibold tabular-nums ${
            urgent ? "text-deck-wrong motion-safe:animate-pulse" : colors.strong
          }`}
        >
          {t("seconds", { seconds: secondsLeft })}
        </span>
      </div>
      <div className={`h-2 overflow-hidden rounded-full ${colors.track}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
            urgent ? "bg-deck-wrong" : paused ? colors.pausedFill : colors.fill
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
