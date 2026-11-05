"use client";

import { useState } from "react";
import { CheckCircle2, CloudAlert, CloudUpload, Hourglass, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { LIVE_ERROR_CODES } from "../../../live/errors";
import { pendingAnswerKey, type PendingAnswer } from "../../../live/reducer";
import { useLive } from "../../../live/store";
import { getSlideRuntime } from "../../../slides/runtime";
import { isGradedSlide } from "../../../slides/shared";
import type { AnswerPayload, AudienceParticipantView, AudienceSlideView } from "../../../types";
import { refusalTitleKey } from "../ParticipantSlide";
import { AudienceResults } from "./AudienceResults";

/** What the participant sent, in words: the picked options, the text, the words. */
export function describeResponse(view: AudienceSlideView): string | null {
  const response = view.response;
  if (!response) return null;
  const options = view.slide.options ?? [];
  const payload = (response.payload ?? null) as Record<string, unknown> | null;
  if (response.optionIndex !== null && options[response.optionIndex]) return options[response.optionIndex]!.text;
  if (Array.isArray(payload?.optionIndices)) {
    return (payload.optionIndices as number[]).map((i) => options[i]?.text).filter(Boolean).join(", ") || null;
  }
  if (response.text) return response.text;
  if (Array.isArray(payload?.entries)) return (payload.entries as string[]).join(", ");
  if (typeof payload?.value === "number") return String(payload.value);
  return null;
}

/**
 * One slide of an audience-paced deck on the phone (W2-F). Content slides show
 * themselves. A response slide shows the type's answer form while it is open
 * and unanswered in the current attempt; then what was sent ("Answer saved"),
 * right or wrong and the explanation once the result is final, and the slide's
 * results when the deck's `resultsVisibility` allows. Answers go through the
 * store's `submitAnswer` for this slide and attempt (socket → REST → offline
 * queue), so an answer saved offline shows "Saved — will sync".
 */
export function AudienceSlideCard({
  view,
  run,
  answeredLocally,
}: {
  view: AudienceSlideView;
  run: AudienceParticipantView;
  answeredLocally: boolean;
}) {
  const t = useTranslations("live.audience");
  const tp = useTranslations("live.participant");
  const submitAnswer = useLive((s) => s.submitAnswer);
  const loadLiveState = useLive((s) => s.loadLiveState);
  const pending: PendingAnswer | undefined = useLive((s) => s.pendingAnswers[pendingAnswerKey(view.slideId, view.slideIndex)]);
  const [submitting, setSubmitting] = useState(false);
  const runtime = getSlideRuntime(view.slide.type);
  if (!runtime) return null;

  if (view.lifecycle !== "response") {
    return (
      <runtime.ParticipantView slide={view.slide} mode="audience" onSubmit={() => {}} submitting={false} />
    );
  }

  const answered = view.answered || answeredLocally;
  const graded = isGradedSlide(view.slide);
  const canAnswer = view.phase === "open" && !run.attempt.submitted && !answered;
  const summary = describeResponse(view);

  const submit = async (payload: AnswerPayload) => {
    setSubmitting(true);
    try {
      const result = await submitAnswer(payload, {
        slideId: view.slideId,
        slideIndex: view.slideIndex,
        slideTicket: view.slideTicket,
        attempt: run.attempt.number,
      });
      if (result.status === "error") {
        if (result.code === LIVE_ERROR_CODES.participantKicked) return;
        if (result.code === LIVE_ERROR_CODES.attemptSubmitted || result.code === LIVE_ERROR_CODES.attemptStale) {
          toast.error(t("attemptOver"));
          void loadLiveState();
        } else if (result.code === LIVE_ERROR_CODES.participantStale) toast.error(tp("rejoinHint"));
        else if (result.code === LIVE_ERROR_CODES.notAccepting || result.code === LIVE_ERROR_CODES.timeUp) {
          toast.error(t("closedTitle"));
        } else if (result.code === LIVE_ERROR_CODES.rateLimited) toast.error(tp("tooManyAttempts"));
        else toast.error(result.message || tp("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-5">
      <h2 className="text-balance text-center text-2xl font-semibold leading-tight tracking-[-0.03em]">{view.slide.question}</h2>

      {canAnswer && pending?.status === "queued" ? (
        <div role="status" className="space-y-2 py-6 text-center">
          <CloudUpload className="mx-auto size-10 text-deck-primary motion-safe:animate-pulse" aria-hidden="true" />
          <p className="text-base font-semibold">{tp("savedOffline")}</p>
          <p className="text-sm text-deck-muted-fg">{tp("savedOfflineHint")}</p>
        </div>
      ) : canAnswer && pending?.status === "refused" ? (
        <div role="status" className="space-y-2 py-6 text-center">
          <CloudAlert className="mx-auto size-10 text-destructive" aria-hidden="true" />
          <p className="text-base font-semibold">{tp(refusalTitleKey(pending.code))}</p>
          <p className="text-sm text-deck-muted-fg">{tp("syncRefusedHint")}</p>
        </div>
      ) : canAnswer ? (
        <runtime.ParticipantView
          key={`${view.slideId}:${run.attempt.number}`}
          slide={view.slide}
          mode="audience"
          onSubmit={(payload) => void submit(payload)}
          submitting={submitting}
        />
      ) : answered ? (
        <div role="status" className="space-y-2 text-center">
          {view.isCorrect === true ? (
            <>
              <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden="true" />
              <p className="text-lg font-semibold text-success">{t("correct")}</p>
              {view.score ? <p className="font-mono text-sm tabular-nums">{t("points", { points: view.score.toLocaleString() })}</p> : null}
            </>
          ) : view.isCorrect === false ? (
            <>
              <XCircle className="mx-auto size-10 text-destructive" aria-hidden="true" />
              <p className="text-lg font-semibold text-destructive">{t("incorrect")}</p>
            </>
          ) : (
            <>
              <CheckCircle2 className="mx-auto size-10 text-info" aria-hidden="true" />
              <p className="text-base font-semibold">{graded ? t("answerLockedIn") : t("answerSaved")}</p>
            </>
          )}
          {summary ? <p className="text-sm text-deck-muted-fg">{t("yourAnswer", { answer: summary })}</p> : null}
        </div>
      ) : (
        <div role="status" className="space-y-2 py-4 text-center">
          <Hourglass className="mx-auto size-10 text-deck-muted-fg/40" aria-hidden="true" />
          <p className="text-base font-semibold">{view.phase === "closed" && !run.attempt.submitted ? t("closedNotAnswered") : t("notAnswered")}</p>
        </div>
      )}

      {view.explanation ? (
        <p className="rounded-xl border border-deck-border bg-deck-surface px-4 py-3 text-sm">
          <span className="font-semibold">{t("why")}: </span>
          {view.explanation}
        </p>
      ) : null}

      {view.results ? (
        <AudienceResults results={view.results} />
      ) : answered && run.resultsVisibility === "after_close" && run.status !== "closed" ? (
        <p className="text-center text-xs text-deck-muted-fg">{t("resultsAfterClose")}</p>
      ) : answered && run.resultsVisibility === "after_submit" && graded && run.assessment.enabled && !run.final ? (
        <p className="text-center text-xs text-deck-muted-fg">{t("resultsAfterAttempts")}</p>
      ) : null}
    </div>
  );
}
