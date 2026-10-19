"use client";

import { useState } from "react";
import { CheckCircle2, Hourglass, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { AnswerPayload, LiveSlide } from "../../types";
import { useLive } from "../../live/store";
import { useCountdown } from "../../live/useCountdown";
import type { SlideRuntime } from "../../slides/runtime";
import { isGradedSlide } from "../../slides/shared";
import { Timer } from "../stage/Timer";

/**
 * A `response` slide on the participant's phone: timer, question, then
 * either the type's answer form or the shell-owned states (submitted, time's
 * up, result after reveal).
 */
export function ParticipantSlide({ slide, runtime }: { slide: LiveSlide; runtime: SlideRuntime }) {
  const t = useTranslations("live.participant");
  const timing = useLive((s) => s.timing);
  const reveal = useLive((s) => s.reveal);
  const me = useLive((s) => s.me);
  const submittedSlideIndex = useLive((s) => s.submittedSlideIndex);
  const submitAnswer = useLive((s) => s.submitAnswer);
  const [submitting, setSubmitting] = useState(false);

  const { secondsLeft, progress, expired } = useCountdown(
    timing?.endsAt,
    timing?.serverNow,
    slide.timeLimit ?? 30
  );
  const hasAnswered = submittedSlideIndex === slide.slideIndex;
  // Ungraded slides (e.g. a 0-point select answer) only confirm the response.
  const graded = isGradedSlide(slide);

  const submit = async (payload: AnswerPayload) => {
    setSubmitting(true);
    try {
      const result = await submitAnswer(payload);
      if (result.status === "error") toast.error(result.message || t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {!reveal && secondsLeft > 0 && <Timer secondsLeft={secondsLeft} progress={progress} />}
      <div className="space-y-2 text-center">
        <span className="text-[10px] font-bold uppercase tracking-widest text-deck-primary/60">
          {t("slideCounter", { current: slide.slideIndex + 1, total: slide.totalSlides })}
        </span>
        <h2 className="text-xl font-bold">{slide.question}</h2>
      </div>

      {/* Post-reveal feedback */}
      {reveal && hasAnswered && me?.lastAnswer ? (
        <div className="text-center space-y-3">
          {!me.lastAnswer.scored || !graded ? (
            <>
              <CheckCircle2 className="size-12 text-deck-info mx-auto" />
              <p className="font-bold">{t("responseReceived")}</p>
            </>
          ) : me.lastAnswer.isCorrect ? (
            <>
              <CheckCircle2 className="size-12 text-deck-correct-soft mx-auto" />
              <p className="text-xl font-bold text-deck-correct-soft">{t("correct")}</p>
              <p className="text-3xl font-black text-deck-primary tabular-nums">
                {t("points", { points: me.lastAnswer.score.toLocaleString() })}
              </p>
            </>
          ) : (
            <>
              <XCircle className="size-12 text-deck-wrong mx-auto" />
              <p className="text-xl font-bold text-deck-wrong">{t("notQuite")}</p>
              <p className="text-sm text-deck-muted-fg">{t("noPoints")}</p>
            </>
          )}
          <div className="rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/[0.03] px-5 py-3 flex items-center justify-between text-sm">
            <span className="text-deck-muted-fg">
              {t.rich("rank", {
                rank: me.rank,
                b: (chunks) => <span className="font-bold text-deck-fg">{chunks}</span>,
              })}
            </span>
            <span className="font-bold text-deck-primary tabular-nums">
              {t("totalPoints", { score: me.totalScore.toLocaleString() })}
            </span>
          </div>
          <p className="text-xs text-deck-muted-fg">{t("waitingAdvance")}</p>
        </div>
      ) : reveal && !hasAnswered ? (
        <div className="text-center py-8 space-y-2">
          <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" />
          <p className="font-bold text-sm">{t("timesUp")}</p>
          <p className="text-xs text-deck-muted-fg">{t("waitingAdvance")}</p>
        </div>
      ) : hasAnswered ? (
        <div className="text-center py-8 space-y-2">
          <CheckCircle2 className="size-10 text-deck-correct-soft mx-auto" />
          <p className="font-bold text-sm">{graded ? t("lockedIn") : t("responseReceived")}</p>
          <p className="text-xs text-deck-muted-fg">
            {graded ? t("waitingReveal") : t("waitingClose")}
          </p>
        </div>
      ) : expired ? (
        <div className="text-center py-8 space-y-2">
          <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" />
          <p className="font-bold text-sm">{t("timesUp")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <runtime.ParticipantView
            // Fresh form state per question (and per re-run of the same slide).
            key={`${slide.slideIndex}:${timing?.endsAt ?? ""}`}
            slide={slide}
            mode="live"
            onSubmit={(payload) => void submit(payload)}
            submitting={submitting}
          />
        </div>
      )}
    </div>
  );
}
