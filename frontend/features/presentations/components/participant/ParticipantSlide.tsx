"use client";

import { useState } from "react";
import { CheckCircle2, Hourglass, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { AnswerPayload, LiveSlide } from "../../types";
import { LIVE_ERROR_CODES } from "../../live/errors";
import { useLive } from "../../live/store";
import { useCountdown } from "../../live/useCountdown";
import type { SlideRuntime } from "../../slides/runtime";
import { isGradedSlide } from "../../slides/shared";
import { Timer } from "../stage/Timer";

/**
 * A `response` slide on the participant's phone: timer, question, then
 * either the type's answer form or the shell-owned states (submitted, voting
 * closed, time's up, result after reveal). The slide's phase (`open` →
 * `closed` → `revealed`, and back to `open` on a reopen) comes from the
 * store, so a revisit shows the stored phase and result.
 */
export function ParticipantSlide({ slide, runtime }: { slide: LiveSlide; runtime: SlideRuntime }) {
  const t = useTranslations("live.participant");
  const timing = useLive((s) => s.timing);
  const phase = useLive((s) => s.phase);
  const slideId = useLive((s) => s.slideId);
  const reveal = useLive((s) => s.reveal);
  const me = useLive((s) => s.me);
  const submittedSlideIndex = useLive((s) => s.submittedSlideIndex);
  const submitAnswer = useLive((s) => s.submitAnswer);
  const [submitting, setSubmitting] = useState(false);

  const { timed, secondsLeft, progress, expired } = useCountdown(timing, slide.timeLimit ?? 30);
  const hasAnswered = submittedSlideIndex === slide.slideIndex;
  // `me` is read after reveals and may still describe the previous slide.
  const lastAnswer =
    me?.lastAnswer && (me.lastAnswer.slideId ?? slideId) === slideId ? me.lastAnswer : null;
  const wasTimed = (slide.timeLimit ?? 0) > 0;
  // Ungraded slides (e.g. a 0-point select answer) only confirm the response.
  const graded = isGradedSlide(slide);

  const submit = async (payload: AnswerPayload) => {
    setSubmitting(true);
    try {
      const result = await submitAnswer(payload);
      if (result.status === "error") {
        // Credentials gone (kicked, stale session): the shell reacts; no toast on top of its screen.
        if (result.code === LIVE_ERROR_CODES.participantKicked) return;
        if (result.code === LIVE_ERROR_CODES.participantStale) toast.error(t("rejoinHint"));
        else if (result.code === LIVE_ERROR_CODES.notAccepting) toast.error(t("votingClosed"));
        else if (result.code === LIVE_ERROR_CODES.timeUp) toast.error(t("timesUp"));
        else if (result.code === LIVE_ERROR_CODES.rateLimited) toast.error(t("tooManyAttempts"));
        else toast.error(result.message || t("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {phase === "open" && timed && !reveal && secondsLeft > 0 && (
        <Timer secondsLeft={secondsLeft} progress={progress} />
      )}
      <div className="space-y-2 text-center">
        <span className="text-sm tabular-nums text-deck-muted-fg">
          {t("slideCounter", { current: slide.slideIndex + 1, total: slide.totalSlides })}
        </span>
        <h2 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.03em]">{slide.question}</h2>
      </div>

      {/* Post-reveal feedback */}
      {reveal && hasAnswered && me && lastAnswer ? (
        <div className="text-center space-y-3">
          {!lastAnswer.scored || !graded ? (
            <>
              <CheckCircle2 className="mx-auto size-12 text-info" />
              <p className="font-semibold">{t("responseReceived")}</p>
            </>
          ) : lastAnswer.isCorrect ? (
            <>
              <CheckCircle2 className="mx-auto size-12 text-success" />
              <p className="text-xl font-semibold text-success">{t("correct")}</p>
              <p className="font-mono text-3xl font-semibold tabular-nums text-deck-fg">
                {t("points", { points: lastAnswer.score.toLocaleString() })}
              </p>
            </>
          ) : (
            <>
              <XCircle className="mx-auto size-12 text-destructive" />
              <p className="text-xl font-semibold text-destructive">{t("notQuite")}</p>
              <p className="text-sm text-deck-muted-fg">{t("noPoints")}</p>
            </>
          )}
          <div className="rounded-xl border border-deck-border bg-deck-surface px-5 py-3 flex items-center justify-between text-sm">
            <span className="text-deck-muted-fg">
              {t.rich("rank", {
                rank: me.rank,
                b: (chunks) => <span className="font-semibold text-deck-fg">{chunks}</span>,
              })}
            </span>
            <span className="font-mono font-semibold tabular-nums text-deck-fg">
              {t("totalPoints", { score: me.totalScore.toLocaleString() })}
            </span>
          </div>
          <p className="text-sm text-deck-muted-fg">{t("waitingAdvance")}</p>
        </div>
      ) : reveal && !hasAnswered ? (
        <div className="text-center py-8 space-y-2">
          <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" />
          <p className="text-base font-semibold">{wasTimed ? t("timesUp") : t("votingClosed")}</p>
          <p className="text-sm text-deck-muted-fg">{t("waitingAdvance")}</p>
        </div>
      ) : hasAnswered ? (
        <div className="text-center py-8 space-y-2">
          <CheckCircle2 className="mx-auto size-10 text-success" />
          <p className="text-base font-semibold">{graded ? t("lockedIn") : t("responseReceived")}</p>
          <p className="text-sm text-deck-muted-fg">
            {graded ? t("waitingReveal") : t("waitingClose")}
          </p>
        </div>
      ) : phase === "closed" ? (
        <div className="text-center py-8 space-y-2">
          <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" />
          <p className="text-base font-semibold">{t("votingClosed")}</p>
          <p className="text-sm text-deck-muted-fg">{t("votingClosedHint")}</p>
        </div>
      ) : expired ? (
        <div className="text-center py-8 space-y-2">
          <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" />
          <p className="text-base font-semibold">{t("timesUp")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <runtime.ParticipantView
            // Fresh form state per question (and per re-run of the same slide).
            key={`${slide.slideIndex}:${timing?.startedAt ?? ""}`}
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
