"use client";

import { useTranslations } from "next-intl";
import { useLive } from "@/features/presentations/live/store";
import { useCountdown } from "@/features/presentations/live/useCountdown";
import { getSlideRuntime } from "@/features/presentations/slides/runtime";

/**
 * Responses to the slide on screen ("12 of 30") with a bar, and its timer:
 * time left, "Timer paused", or "No time limit".
 */
export function ResponseCounter() {
  const t = useTranslations("presenter.console");
  const tPhase = useTranslations("presenter.slide.phase");
  const answered = useLive((s) => s.answeredCount);
  const total = useLive((s) => s.participants.length);
  const status = useLive((s) => s.status);
  const phase = useLive((s) => s.phase);
  const timing = useLive((s) => s.timing);
  const slide = useLive((s) => s.deck?.slides[s.currentSlideIndex] ?? null);
  const countdown = useCountdown(timing, slide?.timeLimit ?? 30);
  const isResponse = status === "active" && slide ? getSlideRuntime(slide.type)?.lifecycle === "response" : false;

  if (!isResponse) {
    return (
      <section aria-label={t("responses")}>
        <p className="text-xs font-medium uppercase tracking-wider text-deck-stage-fg/50">{t("responses")}</p>
        <p className="mt-1 text-sm text-deck-stage-fg/60">{t("noResponses")}</p>
      </section>
    );
  }

  const share = total > 0 ? Math.min(1, answered / total) : 0;
  const timer =
    phase !== "open"
      ? phase
        ? tPhase(phase as "open" | "closed" | "revealed")
        : ""
      : countdown.paused
        ? t("timerPaused")
        : countdown.timed
          ? t("timerLeft", { seconds: countdown.secondsLeft })
          : t("untimed");

  return (
    <section aria-label={t("responses")} className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-deck-stage-fg/50">{t("responses")}</p>
        <p className="text-xs text-deck-stage-fg/60" data-testid="presenter-timer">{timer}</p>
      </div>
      <p className="font-mono text-2xl font-semibold tabular-nums text-deck-stage-fg" data-testid="presenter-responses">
        {t("responsesOf", { answered, total })}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-deck-stage-fg/10" aria-hidden="true">
        <div className="h-full rounded-full bg-deck-accent transition-[width] duration-300" style={{ width: `${share * 100}%` }} />
      </div>
    </section>
  );
}
