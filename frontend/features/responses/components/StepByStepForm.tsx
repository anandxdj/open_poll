"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, RotateCcw, XCircle, Award, BarChart2, RefreshCw } from "lucide-react";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { cn } from "@/lib/utils";

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
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease }}
          className="space-y-6 py-6"
        >
          {/* Badge Header */}
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="relative">
              <div className={`absolute -inset-4 rounded-full blur-xl ${trialResult.passed ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`} />
              <div className={`relative flex size-20 items-center justify-center rounded-full border text-white shadow-xl ${
                trialResult.passed
                  ? 'border-emerald-500 bg-gradient-to-br from-emerald-500 to-teal-700 shadow-emerald-500/20'
                  : 'border-rose-500 bg-gradient-to-br from-rose-500 to-red-700 shadow-rose-500/20'
              }`}>
                {trialResult.passed ? <Award className="size-10" /> : <XCircle className="size-10" />}
              </div>
            </div>

            <div className="space-y-1">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${trialResult.passed ? 'text-emerald-500' : 'text-rose-500'}`}>
                {trialResult.passed ? 'Trial Passed 🎉' : `Trial Attempt #${trialResult.attemptNumber} Failed`}
              </span>
              <h2 className="text-3xl font-extrabold text-foreground">
                Score: {trialResult.percentage}%
              </h2>
              <p className="text-xs text-muted-foreground">
                Passing grade required: <span className="font-bold text-foreground">{trialResult.passingScorePercentage}%</span> ({trialResult.score}/{trialResult.maxScore} points)
              </p>
            </div>
          </div>

          {/* Question Breakdown */}
          <div className="space-y-4 rounded-2xl border border-border/60 bg-secondary/20 p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Question Breakdown
            </h3>

            <div className="space-y-3">
              {trialResult.breakdown.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl border p-4 transition-all ${
                    item.isCorrect
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-rose-500/30 bg-rose-500/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">
                      Q{idx + 1}. {item.questionText}
                    </p>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      item.isCorrect ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {item.isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>

                  {item.explanation && (
                    <p className="mt-2 text-xs text-muted-foreground border-t border-border/40 pt-2">
                      💡 <span className="font-semibold text-foreground">Explanation:</span> {item.explanation}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Retry Button on Failure */}
          {!trialResult.passed && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={handleRetry}
                className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95"
              >
                <RotateCcw className="size-4" />
                Retry Trial
              </button>
            </div>
          )}
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease }}
        className="flex flex-col items-center gap-6 py-12 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20, delay: 0.1 }}
          className="relative"
        >
          <div className="absolute -inset-4 rounded-full bg-primary/10 blur-xl" />
          <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-foreground/20 shadow-[0_0_40px_rgba(216,173,135,0.25)]">
            <CheckCircle2 className="size-10 text-primary-foreground" />
          </div>
        </motion.div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-foreground/90">You&apos;re all done!</h2>
          <p className="text-sm text-muted-foreground/60 max-w-xs">
            Your response has been submitted. Every vote shapes the outcome.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-secondary/30 px-5 py-3 text-xs font-medium text-muted-foreground/60">
          {total} question{total !== 1 ? "s" : ""} answered · Thank you for participating
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="pt-2"
        >
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all cursor-pointer active:scale-95 group"
          >
            <BarChart2 className="size-4 group-hover:scale-110 transition-transform" />
            <span>View Live Results</span>
            <RefreshCw className="size-3.5 opacity-70 group-hover:rotate-180 transition-transform duration-500" />
          </button>
        </motion.div>
      </motion.div>
    );
  }

  // ── Question step ───────────────────────────────────────────────
  return (
    <div className="w-full space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground/50">
          <button
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-1 hover:text-foreground/80 disabled:opacity-0 transition-all"
          >
            <ChevronLeft className="size-3.5" /> Back
          </button>
          <div className="flex items-center gap-4">
            {!current.isMandatory && (
              <button
                type="button"
                onClick={handleSkip}
                className="text-primary hover:text-primary/80 font-bold transition-all px-2.5 py-1 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 select-none uppercase tracking-wide text-[10px]"
              >
                Skip
              </button>
            )}
            <span className="tabular-nums">
              {step + 1} / {total}
            </span>
          </div>
        </div>
        <div className="h-1 rounded-full bg-secondary overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease }}
          />
        </div>
      </div>

      {/* Question card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={qid}
          initial={{ x: 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -32, opacity: 0 }}
          transition={{ duration: 0.3, ease }}
          className="space-y-6"
        >
          {/* Counter */}
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
              Question {step + 1}
            </div>
            {isMulti && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                Multi-Select (Choose all that apply)
              </span>
            )}
          </div>

          {/* Question text */}
          <h2 className="text-2xl font-bold leading-snug text-foreground/90 md:text-3xl">
            {current.text}
          </h2>

          {/* Options */}
          <div className="flex flex-col gap-3">
            {current.options.map((opt, idx) => {
              const isSelected = isMulti ? multiSelections.includes(idx) : selectedNow === idx;
              return (
                <motion.button
                  key={`${qid}-${idx}`}
                  type="button"
                  disabled={submitting || (!isMulti && selectedNow !== null)}
                  onClick={() => (isMulti ? toggleMulti(idx) : chooseSingle(idx))}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "group relative flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all duration-300",
                    isSelected
                      ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_rgba(216,173,135,0.05)]"
                      : "border-border bg-secondary/30 hover:border-primary/30 hover:bg-secondary/50"
                  )}
                >
                  {/* Option letter / checkbox */}
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-all duration-300",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary text-muted-foreground/60 group-hover:border-primary/40 group-hover:text-foreground"
                    )}
                  >
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium leading-snug transition-colors duration-200",
                      isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {opt}
                  </span>
                  {isSelected ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="ml-auto shrink-0"
                    >
                      <CheckCircle2 className="size-5 text-primary" />
                    </motion.div>
                  ) : (
                    <kbd className="ml-auto hidden md:inline-flex items-center justify-center rounded-md border border-border/80 bg-secondary/60 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-muted-foreground/60 shadow-sm transition-all duration-300 group-hover:border-primary/30 group-hover:text-primary group-hover:bg-primary/10 select-none uppercase whitespace-nowrap shrink-0">
                      Press {idx + 1}
                    </kbd>
                  )}
                </motion.button>
              );
            })}
          </div>

          {/* Confirm Multi Button */}
          {isMulti && (
            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={confirmMulti}
                className="rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-md hover:bg-primary/90 transition-all"
              >
                {step >= total - 1 ? "Submit Assessment" : "Confirm Answer →"}
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Submitting indicator */}
      {submitting && (
        <div className="text-center text-xs text-muted-foreground/40 animate-pulse">
          Submitting your answers…
        </div>
      )}
    </div>
  );
}
