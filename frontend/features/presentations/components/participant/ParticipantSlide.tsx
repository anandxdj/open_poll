"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudAlert, CloudUpload, Hourglass, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAnnounce } from "@/components/a11y/live-announcer";
import type { AnswerPayload, LiveSlide } from "../../types";
import { LIVE_ERROR_CODES } from "../../live/errors";
import { pendingAnswerKey, type PendingAnswer } from "../../live/reducer";
import { useLive } from "../../live/store";
import { useCountdown } from "../../live/useCountdown";
import type { SlideRuntime } from "../../slides/runtime";
import { isGradedSlide } from "../../slides/shared";
import { Timer } from "../stage/Timer";

/** Title of a queued answer the server refused for good, by its code. */
export function refusalTitleKey(code: string | null) {
  if (code === LIVE_ERROR_CODES.timeUp) return "syncRefusedTimeUp" as const;
  if (code === LIVE_ERROR_CODES.notAccepting) return "syncRefusedClosed" as const;
  return "syncRefusedOther" as const;
}

/** What the phone shows under the question: the answer form or one of the shell-owned states. */
type SlideView = "result" | "refused" | "queued" | "missed" | "answered" | "closed" | "expired" | "form";

/**
 * A `response` slide on the participant's phone: timer, question, then
 * either the type's answer form or the shell-owned states (submitted, saved
 * offline, refused, voting closed, time's up, result after reveal). The
 * slide's phase (`open` → `closed` → `revealed`, and back to `open` on a
 * reopen) comes from the store, so a revisit shows the stored phase and
 * result. An answer in the offline queue shows "Saved — will sync" until the
 * server takes it (then "locked in") or refuses it (then why).
 *
 * Screen readers (W4-A): each change of state is announced (answer accepted,
 * saved offline, refused, voting closed, time's up, the result with points and
 * rank); when the form disappears under the participant's focus, focus moves
 * to the new state instead of being lost, and that read-out replaces the
 * announcement. Right and wrong are an icon and a word, never colour alone.
 */
export function ParticipantSlide({ slide, runtime }: { slide: LiveSlide; runtime: SlideRuntime }) {
  const t = useTranslations("live.participant");
  const ta = useTranslations("live.announce");
  const timing = useLive((s) => s.timing);
  const phase = useLive((s) => s.phase);
  const slideId = useLive((s) => s.slideId);
  const reveal = useLive((s) => s.reveal);
  const me = useLive((s) => s.me);
  const submittedSlideIndex = useLive((s) => s.submittedSlideIndex);
  const submitAnswer = useLive((s) => s.submitAnswer);
  const pending: PendingAnswer | undefined = useLive((s) => s.pendingAnswers[pendingAnswerKey(s.slideId, slide.slideIndex)]);
  const [submitting, setSubmitting] = useState(false);
  const announce = useAnnounce();
  const stateRef = useRef<HTMLDivElement>(null);

  const { timed, paused, secondsLeft, progress, expired } = useCountdown(timing, slide.timeLimit ?? 30);
  const hasAnswered = submittedSlideIndex === slide.slideIndex;
  // `me` is read after reveals and may still describe the previous slide.
  const lastAnswer =
    me?.lastAnswer && (me.lastAnswer.slideId ?? slideId) === slideId ? me.lastAnswer : null;
  const wasTimed = (slide.timeLimit ?? 0) > 0;
  // Ungraded slides (e.g. a 0-point select answer) only confirm the response.
  const graded = isGradedSlide(slide);
  const scoredResult = Boolean(lastAnswer?.scored && graded);

  const view: SlideView =
    reveal && hasAnswered && me && lastAnswer
      ? "result"
      : !hasAnswered && pending?.status === "refused"
        ? "refused"
        : !hasAnswered && !reveal && pending?.status === "queued"
          ? "queued"
          : reveal && !hasAnswered
            ? "missed"
            : hasAnswered
              ? "answered"
              : phase === "closed"
                ? "closed"
                : expired
                  ? "expired"
                  : "form";

  // The sentence a screen reader hears for the state: the same news as on screen, in words of its
  // own (`live.announce`), so the live region never repeats a visible label word for word.
  const refusedKey = { syncRefusedTimeUp: "refusedTimeUp", syncRefusedClosed: "refusedClosed", syncRefusedOther: "refusedOther" } as const;
  const resultLine = !lastAnswer
    ? ""
    : !scoredResult
      ? ta("received")
      : lastAnswer.isCorrect
        ? ta("correct", { points: lastAnswer.score.toLocaleString() })
        : ta("wrong");
  const message: Record<SlideView, string | null> = {
    result: me ? `${resultLine} ${ta("rank", { rank: me.rank, score: me.totalScore.toLocaleString() })}` : resultLine,
    refused: pending ? ta(refusedKey[refusalTitleKey(pending.code)]) : null,
    queued: ta("queued"),
    missed: wasTimed ? ta("timeUp") : ta("votingEnded"),
    answered: graded ? ta("lockedIn") : ta("received"),
    closed: ta("votingEnded"),
    expired: ta("timeUp"),
    form: null,
  };

  // Announce each new state of this slide; when the form vanished under the participant's focus,
  // move focus onto the new state instead (its content is then read, so no second announcement).
  const viewKey = `${slide.slideIndex}:${view}`;
  const shown = useRef<string | null>(null);
  useEffect(() => {
    const previous = shown.current;
    shown.current = viewKey;
    if (previous === null || previous === viewKey || view === "form") return;
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !active.isConnected;
    if (focusLost && previous.endsWith(":form") && stateRef.current) {
      stateRef.current.focus();
      return;
    }
    const text = message[view];
    if (text) announce(text, view === "refused" ? "assertive" : "polite");
    // `message` and `view` derive from the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const submit = async (payload: AnswerPayload) => {
    // A paused timer takes no answers: the pick stays on the form until the host resumes.
    if (paused) {
      toast.info(t("pausedHint"));
      return;
    }
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
        else if (result.code === LIVE_ERROR_CODES.slidePaused) toast.error(t("pausedHint"));
        else toast.error(result.message || t("submitFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {phase === "open" && timed && !reveal && secondsLeft > 0 && (
        <Timer secondsLeft={secondsLeft} progress={progress} paused={paused} />
      )}
      <div className="space-y-2 text-center">
        <span className="text-sm tabular-nums text-deck-muted-fg">
          {t("slideCounter", { current: slide.slideIndex + 1, total: slide.totalSlides })}
        </span>
        <h2 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.03em]">{slide.question}</h2>
      </div>

      {/* The shell-owned state; focusable (not a tab stop) so focus can land on it. */}
      <div ref={stateRef} tabIndex={-1} className="outline-none" data-testid="participant-slide-state" data-state={view}>
        {view === "result" && me && lastAnswer ? (
          <div className="text-center space-y-3">
            {!scoredResult ? (
              <>
                <CheckCircle2 className="mx-auto size-12 text-info" aria-hidden="true" />
                <p className="font-semibold">{t("responseReceived")}</p>
              </>
            ) : lastAnswer.isCorrect ? (
              <>
                <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden="true" />
                <p className="text-xl font-semibold text-success">{t("correct")}</p>
                <p className="font-mono text-3xl font-semibold tabular-nums text-deck-fg">
                  {t("points", { points: lastAnswer.score.toLocaleString() })}
                </p>
              </>
            ) : (
              <>
                <XCircle className="mx-auto size-12 text-destructive" aria-hidden="true" />
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
        ) : view === "refused" && pending ? (
          <div className="text-center py-8 space-y-2">
            <CloudAlert className="mx-auto size-10 text-destructive" aria-hidden="true" />
            <p className="text-base font-semibold">{t(refusalTitleKey(pending.code))}</p>
            <p className="text-sm text-deck-muted-fg">{t("syncRefusedHint")}</p>
          </div>
        ) : view === "queued" ? (
          <div className="text-center py-8 space-y-2">
            <CloudUpload className="mx-auto size-10 text-deck-primary-ink motion-safe:animate-pulse" aria-hidden="true" />
            <p className="text-base font-semibold">{t("savedOffline")}</p>
            <p className="text-sm text-deck-muted-fg">{t("savedOfflineHint")}</p>
          </div>
        ) : view === "missed" ? (
          <div className="text-center py-8 space-y-2">
            <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" aria-hidden="true" />
            <p className="text-base font-semibold">{wasTimed ? t("timesUp") : t("votingClosed")}</p>
            <p className="text-sm text-deck-muted-fg">{t("waitingAdvance")}</p>
          </div>
        ) : view === "answered" ? (
          <div className="text-center py-8 space-y-2">
            <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden="true" />
            <p className="text-base font-semibold">{graded ? t("lockedIn") : t("responseReceived")}</p>
            <p className="text-sm text-deck-muted-fg">
              {graded ? t("waitingReveal") : t("waitingClose")}
            </p>
          </div>
        ) : view === "closed" ? (
          <div className="text-center py-8 space-y-2">
            <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" aria-hidden="true" />
            <p className="text-base font-semibold">{t("votingClosed")}</p>
            <p className="text-sm text-deck-muted-fg">{t("votingClosedHint")}</p>
          </div>
        ) : view === "expired" ? (
          <div className="text-center py-8 space-y-2">
            <Hourglass className="size-10 text-deck-muted-fg/40 mx-auto" aria-hidden="true" />
            <p className="text-base font-semibold">{t("timesUp")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {paused && (
              // The form stays (and keeps what was picked); sending waits for the host to resume.
              // The timer announces the pause itself, so this is not a live region.
              <p className="rounded-xl border border-deck-border bg-deck-surface px-4 py-3 text-center text-sm text-deck-muted-fg">
                <span className="block font-semibold text-deck-fg">{t("pausedTitle")}</span>
                {t("pausedHint")}
              </p>
            )}
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
    </div>
  );
}
