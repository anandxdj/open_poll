"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import axios from "axios";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft } from "lucide-react";

import type { Poll } from "@/features/polls/store/useCreatorStore";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Props = {
  poll: Poll;
  deviceId: string;
};

const ease = [0.32, 0.72, 0, 1] as const;

export function StepByStepForm({ poll, deviceId }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [selectedNow, setSelectedNow] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const total = poll.questions.length;
  const current = poll.questions[step];
  const qid = String(current._id ?? step);
  const progress = ((step + 1) / total) * 100;

  async function submitAll(finalAnswers: Record<string, number>) {
    setSubmitting(true);
    try {
      await apiClient.post("/responses", {
        pollId: poll._id,
        deviceId,
        answers: poll.questions.map((q) => {
          const id = String(q._id);
          return { questionId: id, selectedOptionIndex: finalAnswers[id] ?? 0 };
        }),
      });
      setDone(true);
    } catch (e: unknown) {
      if (axios.isAxiosError(e)) {
        const msg = e.response?.data?.message;
        toast.error(typeof msg === "string" ? msg : "Could not submit your vote.");
      } else {
        toast.error("Could not submit your vote.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function choose(optionIndex: number) {
    setSelectedNow(optionIndex);
    // Brief delay so user sees the selection before advancing
    setTimeout(() => {
      const nextAnswers = { ...answers, [qid]: optionIndex };
      setAnswers(nextAnswers);
      setSelectedNow(null);
      if (step >= total - 1) {
        void submitAll(nextAnswers);
      } else {
        setStep((s) => s + 1);
      }
    }, 320);
  }

  function goBack() {
    if (step > 0) setStep((s) => s - 1);
  }

  // ── Done state ──────────────────────────────────────────────────
  if (done) {
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
          <h2 className="text-2xl font-bold text-white/90">You&apos;re all done!</h2>
          <p className="text-sm text-white/40 max-w-xs">
            Your response has been submitted. Every vote shapes the outcome.
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 text-xs font-medium text-white/30">
          {total} question{total !== 1 ? "s" : ""} answered · Thank you for participating
        </div>
      </motion.div>
    );
  }

  // ── Question step ───────────────────────────────────────────────
  return (
    <div className="w-full space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-medium text-white/30">
          <button
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-1 hover:text-white/60 disabled:opacity-0 transition-all"
          >
            <ChevronLeft className="size-3.5" /> Back
          </button>
          <span className="tabular-nums">
            {step + 1} / {total}
          </span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
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
          <div className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
            Question {step + 1}
          </div>

          {/* Question text */}
          <h2 className="text-2xl font-bold leading-snug text-white/90 md:text-3xl">
            {current.text}
          </h2>

          {/* Options */}
          <div className="flex flex-col gap-3">
            {current.options.map((opt, idx) => {
              const isSelected = selectedNow === idx;
              return (
                <motion.button
                  key={`${qid}-${idx}`}
                  type="button"
                  disabled={submitting || selectedNow !== null}
                  onClick={() => choose(idx)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    "group relative flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all duration-300",
                    isSelected
                      ? "border-primary/60 bg-primary/15 shadow-[0_0_20px_rgba(216,173,135,0.1)]"
                      : "border-white/[0.08] bg-white/[0.03] hover:border-white/[0.16] hover:bg-white/[0.06]"
                  )}
                >
                  {/* Option letter */}
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-all duration-300",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-white/[0.1] bg-white/[0.04] text-white/40 group-hover:border-white/[0.2] group-hover:text-white/60"
                    )}
                  >
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium leading-snug transition-colors duration-200",
                      isSelected ? "text-white" : "text-white/70 group-hover:text-white/85"
                    )}
                  >
                    {opt}
                  </span>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="ml-auto shrink-0"
                    >
                      <CheckCircle2 className="size-5 text-primary" />
                    </motion.div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Submitting indicator */}
      {submitting && (
        <div className="text-center text-xs text-white/30 animate-pulse">
          Submitting your answers…
        </div>
      )}
    </div>
  );
}
