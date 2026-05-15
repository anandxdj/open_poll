"use client";

import { Plus } from "lucide-react";

import type { QuestionForm } from "@/features/polls/components/create/types";
import { PollQuestionCard } from "@/features/polls/components/create/PollQuestionCard";

type PollQuestionsPanelProps = {
  questions: QuestionForm[];
  activeIndex: number;
  onAddQuestion: () => void;
  onRemoveQuestion: (index: number) => void;
  onUpdateQuestion: (index: number, patch: Partial<QuestionForm>) => void;
  onUpdateOption: (qIndex: number, optIndex: number, value: string) => void;
  onAddOption: (qIndex: number) => void;
  onRemoveOption: (qIndex: number, optIndex: number) => void;
};

export function PollQuestionsPanel({
  questions,
  activeIndex,
  onAddQuestion,
  onRemoveQuestion,
  onUpdateQuestion,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
}: PollQuestionsPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 pb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
          Question Stack
        </h3>
        <button
          type="button"
          onClick={onAddQuestion}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground/60 hover:border-primary/30 hover:text-primary/70 transition-all"
        >
          <Plus className="size-3.5" /> Add
        </button>
      </div>

      <div className="space-y-3">
        {questions.map((q, qi) => (
          <PollQuestionCard
            key={qi}
            question={q}
            index={qi}
            canRemove={questions.length > 1}
            onRemove={() => onRemoveQuestion(qi)}
            onChange={(patch) => onUpdateQuestion(qi, patch)}
            onOptionChange={(oi, v) => onUpdateOption(qi, oi, v)}
            onAddOption={() => onAddOption(qi)}
            onRemoveOption={(oi) => onRemoveOption(qi, oi)}
          />
        ))}
      </div>
    </div>
  );
}
