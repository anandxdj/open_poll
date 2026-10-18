"use client";

import type { PresentationSlide } from "../../types";
import { useLive } from "../../live/store";
import { getSlideRuntime } from "../../slides/runtime";
import { StageView } from "./StageView";
import { Timer } from "./Timer";

export interface StageCountdown {
  secondsLeft: number;
  progress: number;
}

/** The slide on the projected screen: counter, question, timer, and the type's StageView. */
export function StageSlide({ slide, countdown }: { slide: PresentationSlide; countdown: StageCountdown }) {
  const slideIndex = useLive((s) => s.currentSlideIndex);
  const totalSlides = useLive((s) => s.totalSlides);
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
          SLIDE {slideIndex + 1} OF {totalSlides}
        </span>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight px-4 text-deck-stage-fg leading-tight">
          {slide.question}
        </h2>
      </div>

      {isResponse ? (
        <>
          {!reveal && countdown.secondsLeft > 0 && (
            <Timer secondsLeft={countdown.secondsLeft} progress={countdown.progress} />
          )}
          {stageView}
          <p className="sm:hidden text-center text-xs text-deck-stage-fg/40 font-mono">
            {answeredCount} / {participants.length} answered
          </p>
        </>
      ) : (
        stageView
      )}
    </div>
  );
}
