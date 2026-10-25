"use client";

import { useTranslations } from "next-intl";

import type { PresentationSlide } from "../../types";
import { useLive } from "../../live/store";
import { getSlideRuntime } from "../../slides/runtime";
import { StageView } from "./StageView";
import { Timer } from "./Timer";

export interface StageCountdown {
  /** False for an untimed answer window (no deadline). */
  timed: boolean;
  secondsLeft: number;
  progress: number;
}

/**
 * The slide on the projected screen: counter, question, the answer window's
 * state (timer, or the phase of an untimed one), and the type's StageView.
 * A revisited slide shows its stored phase and results.
 */
export function StageSlide({ slide, countdown }: { slide: PresentationSlide; countdown: StageCountdown }) {
  const t = useTranslations("presenter.slide");
  const slideIndex = useLive((s) => s.currentSlideIndex);
  const totalSlides = useLive((s) => s.totalSlides);
  const phase = useLive((s) => s.phase);
  const reveal = useLive((s) => s.reveal);
  const distribution = useLive((s) => s.distribution);
  const answeredCount = useLive((s) => s.answeredCount);
  const leaderboard = useLive((s) => s.leaderboard);
  const participants = useLive((s) => s.participants);

  const isResponse = getSlideRuntime(slide.type)?.lifecycle === "response";
  const stageView = (
    <StageView
      slide={slide}
      live={{ distribution, answeredCount, leaderboard }}
      reveal={reveal}
      participants={participants}
      mode={reveal ? "reveal" : "live"}
    />
  );

  return (
    <div className="my-auto w-full max-w-4xl space-y-5 font-sans animate-in fade-in slide-in-from-bottom-4 duration-500 sm:space-y-7">
      <div className="space-y-3 text-center">
        <span className="text-sm tabular-nums text-deck-stage-fg/60">
          {t("counter", { current: slideIndex + 1, total: totalSlides })}
        </span>
        <h2 className="text-balance px-4 text-3xl font-semibold leading-tight tracking-[-0.035em] text-deck-stage-fg sm:text-5xl">
          {slide.question}
        </h2>
      </div>

      {isResponse ? (
        <>
          {phase === "open" && !reveal && countdown.timed && countdown.secondsLeft > 0 && (
            <Timer secondsLeft={countdown.secondsLeft} progress={countdown.progress} />
          )}
          {phase && phase !== "shown" && (
            <p className="text-center text-sm font-medium text-deck-stage-fg/70">
              {t(`phase.${phase}`)}
              {phase === "open" && !countdown.timed && (
                <span className="mt-1 block font-normal text-deck-stage-fg/50">
                  {t("untimed")}
                </span>
              )}
            </p>
          )}
          {stageView}
          <p className="text-center font-mono text-xs text-deck-stage-fg/50 sm:hidden">
            {t("answeredOf", { answered: answeredCount, total: participants.length })}
          </p>
        </>
      ) : (
        stageView
      )}
    </div>
  );
}
