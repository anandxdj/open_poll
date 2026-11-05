"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, RotateCcw, XCircle, Award, BarChart2 } from "lucide-react";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Props = {
  poll: Poll;
  deviceId: string;
  guestInfo?: { name: string; email: string } | null;
};

type TrialBreakdownItem = {
  questionId: string;
  questionText: string;
  userSelectedIndices: number[];
  correctOptionIndices?: number[];
  isCorrect: boolean;
  explanation?: string;
};

type TrialResult = {
  passed: boolean;
  score: number;
  maxScore: number;
  percentage: number;
  passingScorePercentage: number;
  attemptNumber: number;
  breakdown: TrialBreakdownItem[];
};

type ApiOk<T> = { success: boolean; message: string; data: T };

const ease = [0.32, 0.72, 0, 1] as const;

export function StepByStepForm({ poll, deviceId, guestInfo }: Props) {
  const isTrial = poll.pollType === 'TRIAL';

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [multiSelections, setMultiSelections] = useState<number[]>([]);
  const [selectedNow, setSelectedNow] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [trialResult, setTrialResult] = useState<TrialResult | null>(() => {
    if (!isTrial) return null;
    try {
      const stored = localStorage.getItem(`openpoll_trial_result_${poll._id}`);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [done, setDone] = useState<boolean>(() => {
    if (isTrial) {
      return !!localStorage.getItem(`openpoll_trial_result_${poll._id}`);
    }
    return false;
  });
  const { user } = useAuthStore();

  const total = poll.questions.length;
  const current = poll.questions[step];
  const qid = String(current._id ?? step);
  const isMulti = current.type === 'multiple';
  const progress = ((step + 1) / total) * 100;

  // Reset multiSelections when the question or saved answers change — adjusted
  // during render rather than in an effect.
  const [syncedFor, setSyncedFor] = useState({ qid, answers });
  if (syncedFor.qid !== qid || syncedFor.answers !== answers) {
    setSyncedFor({ qid, answers });
    setMultiSelections(answers[qid] || []);
    setSelectedNow(null);
  }

  function handleRetry() {
    try {
      localStorage.removeItem(`openpoll_trial_result_${poll._id}`);
      localStorage.removeItem(`openpoll_voted_${poll._id}`);
    } catch {
      // ignore
    }
    setStep(0);
    setAnswers({});
    setTrialResult(null);
    setDone(false);
  }

  async function submitAll(finalAnswers: Record<string, number[]>) {
    setSubmitting(true);

    try {
      // Server-issued single-use ballot — the dedup anchor for this submission.
      // Fetched per submit, so every trial retry gets a fresh one.
      const ballotRes = await apiClient.post<ApiOk<{ ballotToken: string }>>(
        `/responses/poll/${poll._id}/ballot`
      );
      const { ballotToken } = ballotRes.data.data;

      // Guests carry a server-signed identity, never a self-asserted string.
      let guestToken: string | undefined;
      if (!user?._id && guestInfo) {
        const guestRes = await apiClient.post<ApiOk<{ guestToken: string }>>(
          "/responses/guest-token",
          { name: guestInfo.name, email: guestInfo.email }
        );
        guestToken = guestRes.data.data.guestToken;
      }

      const res = await apiClient.post<ApiOk<{ trialResult?: TrialResult }>>("/responses", {
        pollId: poll._id,
        ballotToken,
        guestToken,
        deviceId,
        answers: poll.questions
          .filter((q) => {
            const id = String(q._id);
            return q.isMandatory || (finalAnswers[id] && finalAnswers[id].length > 0);
          })
          .map((q) => {
            const id = String(q._id);
            const indices = finalAnswers[id] || [0];
            return {
              questionId: id,
              selectedOptionIndex: indices[0] ?? 0,
              selectedOptionIndices: indices,
            };
          }),
      });

      const trialResultData = res.data.data?.trialResult;

      if (isTrial && trialResultData) {
        setTrialResult(trialResultData);
        try {
          localStorage.setItem(`openpoll_trial_result_${poll._id}`, JSON.stringify(trialResultData));
          localStorage.setItem(`openpoll_voted_${poll._id}`, "true");
        } catch {
          // ignore
        }
      } else {
        localStorage.setItem(`openpoll_voted_${poll._id}`, "true");
      }

      setDone(true);
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        const msg = e.response?.data?.message;
        toast.error(typeof msg === "string" ? msg : "Could not submit your response.");
      } else {
        toast.error("Could not submit your response.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function chooseSingle(optionIndex: number) {
    setSelectedNow(optionIndex);
    setTimeout(() => {
      const nextAnswers = { ...answers, [qid]: [optionIndex] };
      setAnswers(nextAnswers);
      setSelectedNow(null);
      if (step >= total - 1) {
        void submitAll(nextAnswers);
      } else {
        setStep((s) => s + 1);
      }
    }, 320);
  }

  function toggleMulti(optionIndex: number) {
    setMultiSelections((prev) =>
      prev.includes(optionIndex)
        ? prev.filter((i) => i !== optionIndex)
        : [...prev, optionIndex].sort((a, b) => a - b)
    );
  }

  function confirmMulti() {
    if (multiSelections.length === 0 && current.isMandatory) {
      toast.error("Please select at least one option.");
      return;
    }
    const nextAnswers = { ...answers, [qid]: multiSelections };
    setAnswers(nextAnswers);
    if (step >= total - 1) {
      void submitAll(nextAnswers);
    } else {
      setStep((s) => s + 1);
    }
  }

  function handleSkip() {
    if (step >= total - 1) {
      void submitAll(answers);
    } else {
      setStep((s) => s + 1);
    }
  }

  function goBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  // Keyboard shortcuts
  const currentOptionsLength = current?.options?.length ?? 0;
  // Effect Event: always reads the latest state without re-subscribing.
  const handleKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (submitting || done || selectedNow !== null) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    const numOptions = currentOptionsLength;
    const key = e.key;

    if (key === "Backspace" || key === "ArrowLeft") {
      e.preventDefault();
      goBack();
      return;
    }

    const parsedNum = parseInt(key, 10);
    if (!isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= numOptions) {
      e.preventDefault();
      if (isMulti) {
        toggleMulti(parsedNum - 1);
      } else {
        chooseSingle(parsedNum - 1);
      }
    }

    if (isMulti && key === "Enter") {
      e.preventDefault();
      confirmMulti();
    }
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => handleKeyDown(e);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Done / Trial Result State ─────────────────────────────────────
  if (done) {
    if (isTrial && trialResult) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease }}
          className="space-y-8"
        >
          <div className="space-y-3">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                trialResult.passed
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              )}
            >
              {trialResult.passed ? <Award className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
              {trialResult.passed ? "Passed" : `Not passed, attempt ${trialResult.attemptNumber}`}
            </span>
            <p className="font-mono text-6xl font-medium leading-none tabular-nums tracking-[-0.04em]">
              {trialResult.percentage}%
            </p>
            <p className="text-sm text-muted-foreground">
              Pass mark <span className="font-mono tabular-nums text-foreground">{trialResult.passingScorePercentage}%</span>.{" "}
              <span className="font-mono tabular-nums text-foreground">{trialResult.score}</span> of{" "}
              <span className="font-mono tabular-nums text-foreground">{trialResult.maxScore}</span> points.
            </p>
          </div>

          <section aria-labelledby="breakdown-title" className="space-y-3">
            <h3 id="breakdown-title" className="text-lg font-semibold tracking-[-0.02em]">
              Your answers
            </h3>
            <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {trialResult.breakdown.map((item, idx) => (
                <li key={idx} className="space-y-2 px-4 py-3.5">
                  <div className="flex items-start gap-3">
                    <span className="w-5 shrink-0 pt-0.5 font-mono text-sm tabular-nums text-muted-foreground">{idx + 1}</span>
                    <p className="min-w-0 flex-1 text-base font-medium leading-snug text-foreground">{item.questionText}</p>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                        item.isCorrect
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-destructive/30 bg-destructive/10 text-destructive"
                      )}
                    >
                      {item.isCorrect ? <CheckCircle2 className="size-3.5" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
                      {item.isCorrect ? "Correct" : "Incorrect"}
                    </span>
                  </div>
                  {item.explanation && (
                    <p className="pl-8 text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Explanation: </span>
                      {item.explanation}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {!trialResult.passed && (
            <Button onClick={handleRetry}>
              <RotateCcw /> Try again
            </Button>
          )}
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease }}
        className="space-y-6 rounded-xl border border-border bg-card p-6 sm:p-8"
      >
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
          className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success"
        >
          <CheckCircle2 className="size-6" aria-hidden />
        </motion.span>
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.03em]">Your answers are in</h2>
          <p className="text-base text-muted-foreground">
            You answered <span className="font-mono tabular-nums text-foreground">{total}</span> question
            {total !== 1 ? "s" : ""}. Thanks for taking part.
          </p>
        </div>
        <Button onClick={() => window.location.reload()}>
          <BarChart2 /> See live results
        </Button>
      </motion.div>
    );
  }

  // ── Question step ───────────────────────────────────────────────
  return (
    <div className="w-full space-y-8">
      {/* Progress */}
      <div className="space-y-2.5">
        <div className="flex min-h-8 items-center justify-between text-sm text-muted-foreground">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="-ml-1 flex items-center gap-1 rounded-md px-1 py-1 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:invisible"
          >
            <ChevronLeft className="size-4" aria-hidden /> Back
          </button>
          <div className="flex items-center gap-3">
            {!current.isMandatory && (
              <Button type="button" variant="outline" size="sm" className="bg-card" onClick={handleSkip}>
                Skip
              </Button>
            )}
            <span className="font-mono tabular-nums">
              {step + 1} of {total}
            </span>
          </div>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease }}
          />
        </div>
      </div>

      {/* Question */}
      <AnimatePresence mode="wait">
        <motion.div
          key={qid}
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -24, opacity: 0 }}
          transition={{ duration: 0.25, ease }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>Question {step + 1}</span>
              {isMulti && (
                <span className="rounded-full border border-border bg-card px-2 py-0.5 text-xs text-foreground">
                  Choose all that apply
                </span>
              )}
            </div>
            <h2 className="text-balance text-2xl font-semibold leading-tight tracking-[-0.03em] md:text-3xl">
              {current.text}
            </h2>
          </div>

          {/* Options */}
          <div className="flex flex-col gap-2.5">
            {current.options.map((opt, idx) => {
              const isSelected = isMulti ? multiSelections.includes(idx) : selectedNow === idx;
              return (
                <button
                  key={`${qid}-${idx}`}
                  type="button"
                  aria-pressed={isMulti ? isSelected : undefined}
                  disabled={submitting || (!isMulti && selectedNow !== null)}
                  onClick={() => (isMulti ? toggleMulti(idx) : chooseSingle(idx))}
                  className={cn(
                    "group flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card shadow-[0_1px_2px_rgb(23_23_23/0.06)] hover:border-foreground/25"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-sm transition-colors duration-150",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="min-w-0 flex-1 text-base leading-snug text-foreground">{opt}</span>
                  {isSelected ? (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="shrink-0">
                      <CheckCircle2 className="size-5 text-accent-ink" aria-hidden />
                    </motion.span>
                  ) : (
                    // Number keys pick an option on a keyboard.
                    <kbd className="hidden shrink-0 rounded border border-border bg-background px-1.5 font-mono text-xs text-muted-foreground md:inline">
                      {idx + 1}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>

          {isMulti && (
            <div className="flex justify-end">
              <Button type="button" disabled={submitting} onClick={confirmMulti}>
                {step >= total - 1 ? "Submit answers" : "Next question"}
              </Button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {submitting && (
        <p role="status" className="text-sm text-muted-foreground">
          Sending your answers…
        </p>
      )}
    </div>
  );
}
