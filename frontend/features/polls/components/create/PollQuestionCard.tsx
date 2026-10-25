"use client";

import { useEffect, useId, useRef } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { QuestionForm } from "./types";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

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
  const uid = useId();

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

  const pressed = (on: boolean) =>
    cn(
      "h-7 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
      on ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <motion.div
      key={index}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.25, ease }}
      className="rounded-xl border border-border bg-card shadow-[0_24px_48px_-32px_rgb(23_23_23/0.3)]"
    >
      {/* Question meta */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 font-mono text-sm font-medium text-accent-ink">
            {index + 1}
          </span>
          {isTrial ? (
            <div role="group" aria-label="Answer type" className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
              <button
                type="button"
                aria-pressed={qType === 'single'}
                onClick={() => onChange({ type: 'single', correctOptionIndices: correctIndices.slice(0, 1) })}
                className={pressed(qType === 'single')}
              >
                Single answer
              </button>
              <button type="button" aria-pressed={qType === 'multiple'} onClick={() => onChange({ type: 'multiple' })} className={pressed(qType === 'multiple')}>
                Multi-select
              </button>
            </div>
          ) : (
            <span className="text-sm font-medium text-foreground">Multiple choice</span>
          )}
          {isTrial && correctIndices.length === 0 && (
            <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
              Needs a correct answer
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Required
            <Switch checked={question.isMandatory} onCheckedChange={(v) => onChange({ isMandatory: v })} />
          </label>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Delete question ${index + 1}`}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-7 p-5 sm:p-6">
        {/* Question textarea */}
        <div className="space-y-2">
          <label htmlFor={`${uid}-question`} className="text-sm font-medium text-foreground">
            Question
          </label>
          <textarea
            id={`${uid}-question`}
            ref={textareaRef}
            value={question.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={isTrial ? "Enter assessment question..." : "What would you like to ask?"}
            className="min-h-[44px] w-full resize-none overflow-hidden border-none bg-transparent p-0 text-3xl font-semibold leading-tight tracking-[-0.03em] text-foreground placeholder:text-faint focus:outline-none focus:ring-0 [field-sizing:content]"
            rows={1}
          />
        </div>

        {/* Options */}
        <fieldset className="space-y-2.5">
          <legend className="mb-2.5 text-sm font-medium text-foreground">
            Answer choices
            {isTrial ? <span className="ml-2 font-normal text-muted-foreground">Tick the correct answer</span> : null}
          </legend>

          <AnimatePresence>
            {question.options.map((opt, oi) => {
              const isCorrect = correctIndices.includes(oi);

              return (
                <motion.div
                  key={oi}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={{ duration: 0.2, ease }}
                  className="group flex items-center gap-2.5"
                >
                  {/* Correct answer marker (assessments) or the choice number */}
                  {isTrial ? (
                    <button
                      type="button"
                      onClick={() => toggleCorrectOption(oi)}
                      aria-pressed={isCorrect}
                      aria-label={`Choice ${oi + 1} is correct`}
                      title={isCorrect ? "Correct answer" : "Mark as correct"}
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md border font-mono text-xs transition-colors",
                        isCorrect
                          ? "border-success bg-success text-white"
                          : "border-border bg-card text-muted-foreground hover:border-success/50 hover:text-success",
                      )}
                    >
                      {isCorrect ? <Check className="size-4 stroke-[3]" /> : oi + 1}
                    </button>
                  ) : (
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border font-mono text-xs text-muted-foreground group-focus-within:border-ring group-focus-within:text-accent-ink">
                      {oi + 1}
                    </span>
                  )}

                  <input
                    value={opt}
                    onChange={(e) => onOptionChange(oi, e.target.value)}
                    placeholder={`Choice ${oi + 1}`}
                    aria-label={`Choice ${oi + 1}`}
                    className={cn(
                      "h-10 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25",
                      isTrial && isCorrect ? "border-success/60" : "border-input",
                    )}
                  />

                  {question.options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => onRemoveOption(oi)}
                      aria-label={`Remove choice ${oi + 1}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {question.options.length < 10 && (
            <button
              type="button"
              onClick={onAddOption}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent/50 hover:text-foreground"
            >
              <Plus className="size-4" />
              Add choice
            </button>
          )}
        </fieldset>

        {/* Assessment explanation */}
        {isTrial && (
          <div className="space-y-2">
            <label htmlFor={`${uid}-explanation`} className="text-sm font-medium text-foreground">
              Explanation <span className="font-normal text-muted-foreground">Shown after the respondent passes</span>
            </label>
            <textarea
              id={`${uid}-explanation`}
              value={question.explanation || ""}
              onChange={(e) => onChange({ explanation: e.target.value })}
              placeholder="Explain why these choices are correct..."
              className="min-h-[72px] w-full resize-none rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
              rows={2}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}
