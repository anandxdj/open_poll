"use client";

import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { QuestionForm } from "./types";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.32, 0.72, 0, 1] as const;

type PollQuestionCardProps = {
  question: QuestionForm;
  index: number;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (patch: Partial<QuestionForm>) => void;
  onOptionChange: (optionIndex: number, value: string) => void;
  onAddOption: () => void;
  onRemoveOption: (optionIndex: number) => void;
};

export function PollQuestionCard({
  question,
  index,
  canRemove,
  onRemove,
  onChange,
  onOptionChange,
  onAddOption,
  onRemoveOption,
}: PollQuestionCardProps) {
  return (
    <motion.div
      key={index}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease }}
      className="space-y-8"
    >
      {/* Question meta */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">
            {index + 1}
          </div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Multiple Choice
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Required
            </span>
            <Switch
              checked={question.isMandatory}
              onCheckedChange={(v) => onChange({ isMandatory: v })}
              className="scale-75"
            />
          </div>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400 transition-all duration-200"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Question textarea */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Question
        </label>
        <textarea
          value={question.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="What would you like to ask?"
          className="w-full resize-none bg-transparent border-none p-0 focus:outline-none focus:ring-0 text-3xl font-bold text-foreground placeholder:text-muted-foreground min-h-[80px] leading-tight"
          rows={2}
        />
     
      </div>

      {/* Options */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Answer Choices
        </label>

        <div className="space-y-2">
          <AnimatePresence>
            {question.options.map((opt, oi) => (
              <motion.div
                key={oi}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2, ease }}
                className="group flex items-center gap-3"
              >
                {/* Option number */}
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/30 text-[10px] font-bold text-muted-foreground group-focus-within:border-primary group-focus-within:bg-primary group-focus-within:text-primary-foreground group-focus-within:shadow-[0_0_15px_rgba(216,173,135,0.4)] transition-all duration-300">
                  {oi + 1}
                </div>

                {/* Input */}
                <div className="flex flex-1 items-center gap-3 rounded-xl border border-border bg-secondary/30 px-4 py-3 group-focus-within:border-primary/50 group-focus-within:bg-primary/5 group-focus-within:shadow-[0_0_15px_rgba(216,173,135,0.1)] transition-all duration-300">
                  <input
                    value={opt}
                    onChange={(e) => onOptionChange(oi, e.target.value)}
                    placeholder={`Choice ${oi + 1}`}
                    className="flex-1 bg-transparent border-none p-0 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                  />
                </div>

                {/* Remove */}
                {question.options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onRemoveOption(oi)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Add option */}
          {question.options.length < 10 && (
            <button
              type="button"
              onClick={onAddOption}
              className="group flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 text-muted-foreground transition-all duration-300 hover:border-primary hover:bg-primary/5 hover:text-primary hover:shadow-[0_0_20px_rgba(216,173,135,0.15)]"
            >
              <div className="flex size-5 items-center justify-center rounded-md border border-dashed border-current transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-solid">
                <Plus className="size-3" />
              </div>
              <span className="text-xs font-semibold">Add choice</span>
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
