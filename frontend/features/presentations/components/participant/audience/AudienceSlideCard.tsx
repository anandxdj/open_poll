"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudAlert, CloudUpload, Hourglass, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAnnounce } from "@/components/a11y/live-announcer";
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

type CardView = "queued" | "refused" | "form" | "answered" | "unanswered";

/**
 * One slide of an audience-paced deck on the phone (W2-F). Content slides show
 * themselves. A response slide shows the type's answer form while it is open
 * and unanswered in the current attempt; then what was sent ("Answer saved"),
 * right or wrong and the explanation once the result is final, and the slide's
 * results when the deck's `resultsVisibility` allows. Answers go through the
 * store's `submitAnswer` for this slide and attempt (socket → REST → offline
 * queue), so an answer saved offline shows "Saved — will sync".
 *
 * Screen readers (W4-A): each change of state (saved, saved offline, refused,
 * right or wrong, results shown) is announced; when the form disappears under
 * the participant's focus, focus moves onto the new state instead.
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
  const ta = useTranslations("live.announce");
  const submitAnswer = useLive((s) => s.submitAnswer);
  const loadLiveState = useLive((s) => s.loadLiveState);
  const pending: PendingAnswer | undefined = useLive((s) => s.pendingAnswers[pendingAnswerKey(view.slideId, view.slideIndex)]);
  const [submitting, setSubmitting] = useState(false);
  const announce = useAnnounce();
  const stateRef = useRef<HTMLDivElement>(null);
  const runtime = getSlideRuntime(view.slide.type);

  const answered = view.answered || answeredLocally;
  const graded = isGradedSlide(view.slide);
  const canAnswer = view.phase === "open" && !run.attempt.submitted && !answered;
  const summary = describeResponse(view);
  const cardView: CardView =
    canAnswer && pending?.status === "queued"
      ? "queued"
      : canAnswer && pending?.status === "refused"
        ? "refused"
        : canAnswer
          ? "form"
          : answered
            ? "answered"
            : "unanswered";

  // Screen-reader sentences in words of their own (`live.announce`), never a visible label verbatim.
  const refusedKey = { syncRefusedTimeUp: "refusedTimeUp", syncRefusedClosed: "refusedClosed", syncRefusedOther: "refusedOther" } as const;
  const outcome =
    view.isCorrect === true
      ? view.score
        ? ta("correct", { points: view.score.toLocaleString() })
        : ta("correctNoPoints")
      : view.isCorrect === false
        ? ta("wrongAudience")
        : graded
          ? ta("answerLockedIn")
          : ta("answerSaved");
  const messageFor = (state: CardView): string | null => {
    if (state === "queued") return ta("queued");
    if (state === "refused" && pending) return ta(refusedKey[refusalTitleKey(pending.code)]);
    if (state === "answered") {
      return [outcome, summary ? ta("youAnswered", { answer: summary }) : null, view.results ? ta("resultsShown") : null]
        .filter(Boolean)
        .join(" ");
    }
    return null;
  };

  // Announce a new state of this card (the card is remounted per slide and attempt); move focus onto it
  // when the form vanished under the participant's focus (its content is then read instead).
  const stateKey = `${cardView}:${view.isCorrect ?? ""}:${view.results ? 1 : 0}`;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const previous = shown.current;
    shown.current = stateKey;
    if (previous === null || previous === stateKey || cardView === "form") return;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !active.isConnected;
    if (focusLost && previous.startsWith("form:") && stateRef.current) {
      stateRef.current.focus();
      return;
    }
    const text = messageFor(cardView);
    if (text) announce(text, cardView === "refused" ? "assertive" : "polite");
    // The message derives from the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  if (!runtime) return null;

  if (view.lifecycle !== "response") {
    return (
      <runtime.ParticipantView slide={view.slide} mode="audience" onSubmit={() => {}} submitting={false} />
    );
  }

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

      {/* The card's state; focusable (not a tab stop) so focus can land on it. */}
      <div ref={stateRef} tabIndex={-1} className="outline-none" data-testid="audience-slide-state" data-state={cardView}>
        {cardView === "queued" ? (
          <div className="space-y-2 py-6 text-center">
            <CloudUpload className="mx-auto size-10 text-deck-primary-ink motion-safe:animate-pulse" aria-hidden="true" />
            <p className="text-base font-semibold">{tp("savedOffline")}</p>
            <p className="text-sm text-deck-muted-fg">{tp("savedOfflineHint")}</p>
          </div>
        ) : cardView === "refused" && pending ? (
          <div className="space-y-2 py-6 text-center">
            <CloudAlert className="mx-auto size-10 text-destructive" aria-hidden="true" />
            <p className="text-base font-semibold">{tp(refusalTitleKey(pending.code))}</p>
            <p className="text-sm text-deck-muted-fg">{tp("syncRefusedHint")}</p>
          </div>
        ) : cardView === "form" ? (
          <runtime.ParticipantView
            key={`${view.slideId}:${run.attempt.number}`}
            slide={view.slide}
            mode="audience"
            onSubmit={(payload) => void submit(payload)}
            submitting={submitting}
          />
        ) : cardView === "answered" ? (
          <div className="space-y-2 text-center">
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
          <div className="space-y-2 py-4 text-center">
            <Hourglass className="mx-auto size-10 text-deck-muted-fg/40" aria-hidden="true" />
            <p className="text-base font-semibold">{view.phase === "closed" && !run.attempt.submitted ? t("closedNotAnswered") : t("notAnswered")}</p>
          </div>
        )}
      </div>

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
