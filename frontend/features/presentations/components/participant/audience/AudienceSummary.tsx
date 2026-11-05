"use client";

import { useState } from "react";
import { Award, CircleAlert, CloudUpload, Loader2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-error";
import { retryAudienceAttempt, submitAudienceAttempt } from "../../../api/participant";
import { getApiErrorCode, LIVE_ERROR_CODES } from "../../../live/errors";
import { participantLostReason, useLive, useLiveStore } from "../../../live/store";
import type { AudienceParticipantView } from "../../../types";
import { AUDIENCE_PREFIX } from "./audienceSlice";

/**
 * The end of an audience-paced run (W2-F). Before submitting: how many slides
 * are answered, which are not (jump back to them), and **Submit answers** —
 * held while answers wait in the offline queue (the queue is flushed first, so
 * an attempt is never scored without them). After submitting: the score, and
 * with an assessment pass or fail against the pass mark, earlier attempts and
 * **Try again** while attempts are left; **Review answers** goes back through
 * the slides.
 */
export function AudienceSummary({
  run,
  answered,
  onJump,
  onReview,
}: {
  run: AudienceParticipantView;
  /** slideIds answered in the current attempt (server view plus answers accepted since). */
  answered: Set<string>;
  onJump: (index: number) => void;
  onReview: () => void;
}) {
  const t = useTranslations("live.audience");
  const store = useLiveStore();
  const presentationId = useLive((s) => s.presentationId);
  const self = useLive((s) => s.self);
  const queued = useLive((s) => Object.values(s.pendingAnswers).filter((p) => p.status === "queued").length);
  const [busy, setBusy] = useState<"submit" | "retry" | null>(null);

  const questions = run.slides.filter((slide) => slide.lifecycle === "response");
  const unanswered = questions.filter((slide) => !answered.has(slide.slideId));
  const latest = run.attempts.at(-1) ?? null;
  const current = run.attempt.submitted ? (run.attempts.find((a) => a.number === run.attempt.number) ?? latest) : null;

  const apply = (view: AudienceParticipantView) =>
    store.getState().dispatch({ type: "live/module", prefix: AUDIENCE_PREFIX, name: "view", payload: view });

  const failed = (err: unknown, fallback: string) => {
    const reason = participantLostReason(err);
    if (reason) {
      store.getState().dispatch({ type: "participant/lost", reason });
      return;
    }
    if (getApiErrorCode(err) === LIVE_ERROR_CODES.attemptStale) void store.getState().loadLiveState();
    toast.error(getApiErrorMessage(err) || fallback);
  };

  const submit = async () => {
    if (!presentationId || !self) return;
    setBusy("submit");
    try {
      // Answers saved offline go first: the attempt is scored from what reached the server.
      await store.getState().flushAnswerQueue(true);
      if (Object.values(store.getState().pendingAnswers).some((p) => p.status === "queued")) {
        toast.error(t("syncPending"));
        return;
      }
      apply(await submitAudienceAttempt(presentationId, self.participantId, self.token, run.attempt.number));
    } catch (err: unknown) {
      failed(err, t("submitFailed"));
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    if (!presentationId || !self) return;
    setBusy("retry");
    try {
      const view = await retryAudienceAttempt(presentationId, self.participantId, self.token);
      apply(view);
      toast.success(t("retryStarted", { number: view.attempt.number }));
      onJump(0);
    } catch (err: unknown) {
      failed(err, t("retryFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (!run.attempt.submitted) {
    const closed = run.status === "closed";
    return (
      <div className="w-full space-y-5 text-center">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">{closed ? t("closedTitle") : t("summaryTitle")}</h2>
          <p className="text-sm text-deck-muted-fg">
            {t("summaryHint", { answered: questions.length - unanswered.length, total: questions.length })}
          </p>
        </div>
        {unanswered.length > 0 && !closed ? (
          <div className="space-y-2 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-deck-muted-fg">{t("unansweredList")}</p>
            <ul className="flex flex-wrap gap-2">
              {unanswered.map((slide) => (
                <li key={slide.slideId}>
                  <button
                    type="button"
                    onClick={() => onJump(run.slides.indexOf(slide))}
                    className="min-h-11 rounded-full border border-deck-border px-4 text-sm hover:bg-deck-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-primary/50"
                  >
                    {t("jumpTo", { number: slide.slideIndex + 1 })}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {queued > 0 ? (
          <p role="status" className="flex items-center justify-center gap-2 text-sm text-deck-muted-fg">
            <CloudUpload className="size-4 motion-safe:animate-pulse" aria-hidden="true" /> {t("syncPending")}
          </p>
        ) : null}
        <Button
          onClick={() => void submit()}
          disabled={busy !== null}
          className="h-12 w-full rounded-lg bg-deck-primary text-base font-semibold text-deck-primary-fg"
        >
          {busy === "submit" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {busy === "submit" ? t("submitting") : closed ? t("seeScore") : t("submit")}
        </Button>
      </div>
    );
  }

  const assessment = run.assessment.enabled;
  const passed = current?.passed === true;
  return (
    <div className="w-full space-y-5 text-center">
      <div className="space-y-3">
        {assessment ? (
          passed ? (
            <Award className="mx-auto size-12 text-success" aria-hidden="true" />
          ) : (
            <CircleAlert className="mx-auto size-12 text-destructive" aria-hidden="true" />
          )
        ) : null}
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">{current && current.maxScore > 0 ? t("resultTitle") : t("doneTitle")}</h2>
        {current && current.maxScore > 0 ? (
          <>
            {current.percentage !== null ? (
              <p className="font-mono text-5xl font-semibold tabular-nums">{t("percentage", { percentage: current.percentage })}</p>
            ) : null}
            <p className="text-sm text-deck-muted-fg">{t("score", { score: current.score.toLocaleString(), max: current.maxScore.toLocaleString() })}</p>
          </>
        ) : (
          <p className="text-sm text-deck-muted-fg">{t("doneHint")}</p>
        )}
        {assessment ? (
          <div className="flex items-center justify-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${passed ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}
            >
              {passed ? t("passed") : t("failed")}
            </span>
            <span className="text-sm text-deck-muted-fg">{t("passMark", { percentage: run.assessment.passingScorePercentage })}</span>
          </div>
        ) : null}
        {assessment && !passed ? (
          <p className="text-sm text-deck-muted-fg">
            {run.attemptsLeft === null ? t("attemptsUnlimited") : run.attemptsLeft > 0 ? t("attemptsLeft", { count: run.attemptsLeft }) : t("noAttemptsLeft")}
          </p>
        ) : null}
      </div>

      {run.attempts.length > 1 ? (
        <div className="space-y-1 text-sm text-deck-muted-fg">
          <p className="text-xs font-semibold uppercase tracking-wider">{t("history")}</p>
          <ul>
            {run.attempts.map((attempt) => (
              <li key={attempt.number}>{t("historyRow", { number: attempt.number, percentage: attempt.percentage ?? 0 })}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {run.canRetry ? (
          <Button
            onClick={() => void retry()}
            disabled={busy !== null}
            className="h-12 w-full rounded-lg bg-deck-primary text-base font-semibold text-deck-primary-fg"
          >
            {busy === "retry" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
            {busy === "retry" ? t("retrying") : t("retry")}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onReview} className="h-12 w-full rounded-lg text-base">
          {t("review")}
        </Button>
      </div>
    </div>
  );
}
