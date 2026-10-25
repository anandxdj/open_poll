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
    <div className="max-w-3xl w-full space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto font-sans">
      <div className="text-center space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-deck-primary/10 border border-deck-primary/20 px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-deck-primary font-mono">
          {t("counter", { current: slideIndex + 1, total: totalSlides })}
        </span>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight px-4 text-deck-stage-fg leading-tight">
          {slide.question}
        </h2>
      </div>

      {isResponse ? (
        <>
          {phase === "open" && !reveal && countdown.timed && countdown.secondsLeft > 0 && (
            <Timer secondsLeft={countdown.secondsLeft} progress={countdown.progress} />
          )}
          {phase && phase !== "shown" && (
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-deck-stage-fg/50">
              {t(`phase.${phase}`)}
              {phase === "open" && !countdown.timed && (
                <span className="block normal-case tracking-normal font-medium text-deck-stage-fg/40 mt-1">
                  {t("untimed")}
                </span>
              )}
            </p>
          )}
          {stageView}
          <p className="sm:hidden text-center text-xs text-deck-stage-fg/40 font-mono">
            {t("answeredOf", { answered: answeredCount, total: participants.length })}
          </p>
        </>
      ) : (
        stageView
      )}
    </div>
  );
}
