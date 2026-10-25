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
    <figure className="flex w-full flex-col items-center gap-4">
      {/* A sample of the voting page as respondents see it; one image to assistive tech. */}
      <div
        role="img"
        aria-label={`Preview of question ${questionIndex + 1} on a respondent's phone`}
        className="w-full max-w-[248px] rounded-[2.25rem] border border-border bg-card p-2 shadow-[0_32px_64px_-24px_rgb(23_23_23/0.35)]"
      >
        <div className="flex aspect-[9/17] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background">
          {/* Progress through the poll */}
          <div className="h-1 bg-secondary">
            <motion.div
              className="h-full bg-primary"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease }}
            />
          </div>

          <div className="flex flex-1 flex-col overflow-hidden px-4 pb-4 pt-4">
            <p className="mb-3 flex items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
              <Zap className="size-3.5 shrink-0 text-accent-ink" />
              <span className="truncate">{pollTitle || "Untitled poll"}</span>
            </p>

            <AnimatePresence mode="wait">
              {question ? (
                <motion.div
                  key={questionIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease }}
                  className="flex flex-1 flex-col gap-3"
                >
                  <p className="font-mono text-xs text-muted-foreground">
                    {questionIndex + 1} of {totalQuestions}
                  </p>
                  <p className="line-clamp-3 text-sm font-semibold leading-snug text-foreground">
                    {question.text || "Your question will appear here…"}
                  </p>

                  <div className="flex flex-1 flex-col gap-1.5">
                    {(question.options.length > 0 ? question.options : ["Option A", "Option B"]).map((opt, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2">
                        <span className="size-3.5 shrink-0 rounded-full border border-input" />
                        <span className="line-clamp-1 text-xs text-foreground">{opt || `Option ${i + 1}`}</span>
                      </div>
                    ))}
                  </div>

                  <span className="flex h-9 items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground">
                    {questionIndex === totalQuestions - 1 ? "Submit" : "Next"}
                  </span>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
                >
                  <CheckCircle2 className="size-6 text-faint" />
                  <p className="text-xs text-muted-foreground">Add questions to preview</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <figcaption className="text-sm text-muted-foreground">Respondent view</figcaption>
    </figure>
  );
}
