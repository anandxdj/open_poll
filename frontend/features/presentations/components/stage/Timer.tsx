"use client";

import { useState } from "react";
import { Pause, Timer as TimerIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface TimerProps {
  secondsLeft: number;
  progress: number; // 1 → full time remaining, 0 → expired
  /** The host paused the timer: the value is frozen and labelled "Paused". */
  paused?: boolean;
  /**
   * `audience` (default): the phone (`--deck-bg/fg/primary…`).
   * `stage`: the projected stage (`--deck-stage-*` and the accent). Both follow
   * the deck's light or dark theme.
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
    label: "text-deck-stage-muted",
    strong: "text-deck-stage-fg",
    track: "bg-deck-stage-fg/10",
    fill: "bg-deck-accent",
    pausedFill: "bg-deck-stage-fg/40",
  },
} as const;

/** Seconds left at which a screen reader hears the time (W4-A): milestones, never every second. */
export const TIMER_MILESTONES = [60, 30, 10] as const;

/** The milestone crossed between two readings of a running timer, if any. */
export function crossedMilestone(before: number, now: number): number | null {
  return TIMER_MILESTONES.find((mark) => before > mark && now <= mark) ?? null;
}

/**
 * What the timer's live region says, and a counter that changes with each new
 * announcement (so the same words are read again later): a milestone crossed,
 * or the host pausing / resuming. Tracked during render (the previous reading
 * is state), so no effect has to set state.
 */
function useTimerAnnouncement(secondsLeft: number, paused: boolean) {
  const t = useTranslations("live.timer");
  const [track, setTrack] = useState({ seconds: secondsLeft, paused, message: "", count: 0 });
  if (track.seconds !== secondsLeft || track.paused !== paused) {
    let message: string | null = null;
    if (paused !== track.paused) {
      message = paused ? t("pausedAnnouncement", { seconds: secondsLeft }) : t("resumedAnnouncement", { seconds: secondsLeft });
    } else if (!paused) {
      const mark = crossedMilestone(track.seconds, secondsLeft);
      if (mark !== null) message = t("milestone", { seconds: mark });
    }
    setTrack({
      seconds: secondsLeft,
      paused,
      message: message ?? track.message,
      count: message ? track.count + 1 : track.count,
    });
  }
  return track;
}

/**
 * Countdown bar for an open answer window — stage and participant.
 *
 * Accessibility (W4-A): the readout is a `role="timer"` named "Time left"
 * (its live updates stay silent, as the role implies); a separate polite live
 * region says the milestones (60, 30 and 10 seconds left) and when the host
 * pauses or resumes. The urgent colour is backed by the same numbers, and its
 * pulse stops with reduced motion.
 */
export function Timer({ secondsLeft, progress, paused = false, tone = "audience" }: TimerProps) {
  const t = useTranslations("live.timer");
  const colors = TONES[tone];
  const urgent = !paused && progress <= 0.25;
  const announcement = useTimerAnnouncement(secondsLeft, paused);

  return (
    <div className="space-y-2" data-testid="countdown" data-paused={paused || undefined}>
      <div
        role="timer"
        aria-live="off"
        aria-label={paused ? t("pausedLabel") : t("timeLeft")}
        className="flex items-center justify-between"
      >
        {paused ? (
          <span className={`flex items-center gap-1.5 text-sm font-semibold ${colors.strong}`}>
            <Pause className="size-4" aria-hidden="true" /> {t("paused")}
          </span>
        ) : (
          <span className={`flex items-center gap-1.5 text-sm ${colors.label}`}>
            <TimerIcon className="size-4" aria-hidden="true" /> {t("timeLeft")}
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
      <div className={`h-2 overflow-hidden rounded-full ${colors.track}`} aria-hidden="true">
        <div
          className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
            urgent ? "bg-deck-wrong" : paused ? colors.pausedFill : colors.fill
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="timer-announcement">
        {announcement.message ? <span key={announcement.count}>{announcement.message}</span> : null}
      </p>
    </div>
  );
}
