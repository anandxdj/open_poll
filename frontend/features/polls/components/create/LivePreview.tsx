"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Zap } from "lucide-react";
import type { QuestionForm } from "./types";

const ease = [0.32, 0.72, 0, 1] as const;

type LivePreviewProps = {
  question: QuestionForm | null;
  questionIndex: number;
  totalQuestions: number;
  pollTitle?: string;
};

export function LivePreview({
  question,
  questionIndex,
  totalQuestions,
  pollTitle,
}: LivePreviewProps) {
  const progress = totalQuestions > 0 ? ((questionIndex + 1) / totalQuestions) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Live Preview
      </p>

      {/* Phone frame */}
      <div className="relative w-full max-w-[200px]">
        {/* Glow */}
        <div className="absolute -inset-4 rounded-[4rem] bg-primary/[0.06] blur-2xl" />

        {/* Device */}
        <div className="relative mx-auto w-full aspect-[9/19] rounded-[2.5rem] bg-[#0d0d0d] border-[6px] border-[#1a1a1a] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_48px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col">
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 bg-[#1a1a1a] rounded-b-2xl z-10 flex items-center justify-center">
            <div className="size-1.5 rounded-full bg-[#2a2a2a]" />
          </div>

          {/* Progress bar */}
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-white/[0.05] z-20">
            <motion.div
              className="h-full bg-primary shadow-[0_0_8px_rgba(216,173,135,0.8)]"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease }}
            />
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col overflow-hidden pt-8 px-4 pb-4">
            {/* Poll header */}
            <div className="mb-3 flex items-center gap-1.5">
              <div className="size-4 rounded-md bg-primary flex items-center justify-center">
                <Zap className="size-2.5 text-primary-foreground fill-primary-foreground" />
              </div>
              <span className="truncate text-[8px] font-semibold text-muted-foreground">
                {pollTitle || "Your Poll"}
              </span>
            </div>

            <AnimatePresence mode="wait">
              {question ? (
                <motion.div
                  key={questionIndex}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease }}
                  className="flex flex-col flex-1 gap-3"
                >
                  {/* Question counter */}
                  <div className="text-[8px] font-bold uppercase tracking-widest text-primary/70">
                    Question {questionIndex + 1} of {totalQuestions}
                  </div>

                  {/* Question text */}
                  <p className="text-[11px] font-bold text-white/90 leading-snug line-clamp-3">
                    {question.text || "Your question will appear here…"}
                  </p>

                  {/* Options */}
                  <div className="flex flex-col gap-1.5 flex-1">
                    {(question.options.length > 0 ? question.options : ["Option A", "Option B"]).map(
                      (opt, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 transition-all duration-300 hover:border-primary hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(216,173,135,0.2)] cursor-pointer"
                        >
                          <div className="size-3 rounded-full border border-white/20 shrink-0" />
                          <span className="text-[9px] font-medium text-white/60 line-clamp-1">
                            {opt || `Option ${i + 1}`}
                          </span>
                        </div>
                      )
                    )}
                  </div>

                  {/* Next button */}
                  <button className="w-full rounded-xl bg-primary py-2 text-[9px] font-bold text-primary-foreground transition-all duration-300 hover:opacity-90 hover:shadow-[0_0_15px_rgba(216,173,135,0.4)]">
                    {questionIndex === totalQuestions - 1 ? "Submit →" : "Next →"}
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
                >
                  <CheckCircle2 className="size-6 text-white/20" />
                  <p className="text-[9px] text-white/30">Add questions to preview</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Device label */}
      <p className="text-[9px] font-medium uppercase tracking-widest text-white/20">
        Respondent view
      </p>
    </div>
  );
}
