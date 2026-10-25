"use client";

import { useEffect, useRef } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { QuestionForm } from "./types";
import { motion, AnimatePresence } from "framer-motion";

const ease = [0.32, 0.72, 0, 1] as const;

type PollQuestionCardProps = {
  question: QuestionForm;
  index: number;
  canRemove: boolean;
  pollType?: 'POLL' | 'TRIAL';
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
  pollType = 'POLL',
  onRemove,
  onChange,
  onOptionChange,
  onAddOption,
  onRemoveOption,
}: PollQuestionCardProps) {
  const isTrial = pollType === 'TRIAL';
  const qType = question.type || 'single';
  const correctIndices = question.correctOptionIndices || [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [question.text]);

  const toggleCorrectOption = (oi: number) => {
    if (qType === 'single') {
      onChange({ correctOptionIndices: [oi] });
    } else {
      if (correctIndices.includes(oi)) {
        onChange({ correctOptionIndices: correctIndices.filter((idx) => idx !== oi) });
      } else {
        onChange({ correctOptionIndices: [...correctIndices, oi].sort((a, b) => a - b) });
      }
    }
  };

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
          {isTrial ? (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/50 p-1 text-[10px] font-bold uppercase tracking-wider">
              <button
                type="button"
                onClick={() => onChange({ type: 'single', correctOptionIndices: correctIndices.slice(0, 1) })}
                className={`rounded px-2 py-0.5 transition-colors ${
                  qType === 'single' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Single Answer
              </button>
              <button
                type="button"
                onClick={() => onChange({ type: 'multiple' })}
                className={`rounded px-2 py-0.5 transition-colors ${
                  qType === 'multiple' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Multi-Select
              </button>
            </div>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Multiple Choice
            </span>
          )}
          {isTrial && correctIndices.length === 0 && (
            <span className="rounded-lg bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400 animate-pulse">
              Needs correct answer
            </span>
          )}
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
          ref={textareaRef}
          value={question.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={isTrial ? "Enter assessment question..." : "What would you like to ask?"}
          className="w-full resize-none overflow-hidden bg-transparent border-none p-0 focus:outline-none focus:ring-0 text-3xl font-bold text-foreground placeholder:text-muted-foreground min-h-[44px] leading-tight [field-sizing:content]"
          rows={1}
        />
      </div>

      {/* Options */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Answer Choices {isTrial && <span className="text-emerald-500 font-normal">(Click checkmark to mark correct answer)</span>}
          </label>
        </div>

        <div className="space-y-2">
          <AnimatePresence>
            {question.options.map((opt, oi) => {
              const isCorrect = correctIndices.includes(oi);

              return (
                <motion.div
                  key={oi}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.2, ease }}
                  className="group flex items-center gap-3"
                >
                  {/* Correct Answer Selector (Trial Mode) */}
                  {isTrial ? (
                    <button
                      type="button"
                      onClick={() => toggleCorrectOption(oi)}
                      title={isCorrect ? "Correct Answer" : "Mark as Correct"}
                      className={`flex size-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold transition-all duration-300 ${
                        isCorrect
                          ? 'border-emerald-500 bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:border-emerald-500/50 hover:text-emerald-400'
                      }`}
                    >
                      {isCorrect ? <Check className="size-4 stroke-[3]" /> : oi + 1}
                    </button>
                  ) : (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary/30 text-[10px] font-bold text-muted-foreground group-focus-within:border-primary group-focus-within:bg-primary group-focus-within:text-primary-foreground group-focus-within:shadow-[0_0_15px_rgba(216,173,135,0.4)] transition-all duration-300">
                      {oi + 1}
                    </div>
                  )}

                  {/* Input */}
                  <div className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-300 ${
                    isTrial && isCorrect
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-border bg-secondary/30 group-focus-within:border-primary/50 group-focus-within:bg-primary/5'
                  }`}>
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
              );
            })}
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

      {/* Trial Answer Explanation Box */}
      {isTrial && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-4">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Explanation (Shown to respondent after passing)
          </label>
          <textarea
            value={question.explanation || ""}
            onChange={(e) => onChange({ explanation: e.target.value })}
            placeholder="Explain why these choices are correct..."
            className="w-full resize-none bg-transparent border-none p-0 text-xs font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 min-h-[40px]"
            rows={2}
          />
        </div>
      )}
    </motion.div>
  );
}
