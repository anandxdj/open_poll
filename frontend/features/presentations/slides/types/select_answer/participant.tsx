"use client";

import { useState, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { Check, CheckCircle2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ParticipantViewProps } from "../../runtime";
import { SendingSpinner } from "../../SendingSpinner";

export function SelectAnswerParticipant(props: ParticipantViewProps) {
  return props.slide.allowMultiple ? <MultiSelectAnswer {...props} /> : <SingleSelectAnswer {...props} />;
}

/**
 * Option index for a keyboard shortcut (1-9 or A-Z), or null. Ignores typing in fields and keys
 * with a modifier. The shortcuts work while focus is in the option list only (WCAG 2.1.4: a
 * single-character shortcut must not fire from anywhere on the page).
 */
function shortcutOption(e: KeyboardEvent, optionCount: number): number | null {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.toUpperCase();
  const num = parseInt(key, 10);
  if (!isNaN(num) && num >= 1 && num <= optionCount) return num - 1;
  if (key.length === 1 && key >= "A" && key.charCodeAt(0) - 65 < optionCount) return key.charCodeAt(0) - 65;
  return null;
}

/** `picks` with option `i` added, or removed when it was already picked. */
const toggled = (picks: number[], i: number) => (picks.includes(i) ? picks.filter((j) => j !== i) : [...picks, i]);

function SingleSelectAnswer({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.selectAnswer");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const { options } = slide;
  const inert = mode === "preview";
  const locked = submitting || inert;

  // Keyboard shortcuts while focus is in the list: 1-9 or A-Z select an option.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const option = shortcutOption(e, options.length);
    if (option !== null) setSelectedOption(option);
  };

  return (
    <div className="space-y-4 w-full">
      <div className="grid grid-cols-1 gap-3" role="group" aria-label={t("optionsLabel")} onKeyDown={onKeyDown}>
        {options.map((opt, i) => {
          const isSelected = selectedOption === i;
          const letter = String.fromCharCode(65 + i);

          return (
            <motion.button
              key={i}
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => setSelectedOption(i)}
              disabled={locked}
              aria-pressed={isSelected}
              className={`group relative flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left font-semibold transition-all duration-300 ${
                isSelected
                  ? "border-deck-primary/70 bg-deck-primary/10 text-deck-fg shadow-[0_0_25px_color-mix(in_srgb,var(--deck-primary)_15%,transparent)] ring-1 ring-deck-primary/40"
                  : "border-deck-border/60 bg-deck-surface/60 hover:border-deck-primary/40 hover:bg-deck-secondary/40 text-deck-fg/90"
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  aria-hidden="true"
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-all duration-300 ${
                    isSelected
                      ? "border-deck-primary bg-deck-primary text-deck-primary-fg shadow-sm"
                      : "border-deck-border bg-deck-secondary text-deck-muted-fg group-hover:border-deck-primary/40 group-hover:text-deck-fg"
                  }`}
                >
                  {letter}
                </div>
                <span className="text-base font-semibold leading-snug break-words">
                  {opt.text}
                </span>
              </div>

              {isSelected && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  <CheckCircle2 className="size-5 shrink-0 text-deck-primary-ink" aria-hidden="true" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      <SubmitButton
        label={t("submit")}
        submitting={submitting}
        disabled={locked || selectedOption === null}
        onClick={() => selectedOption !== null && onSubmit({ optionIndex: selectedOption })}
      />
    </div>
  );
}

/** Checkbox list: pick one or more options, then submit them together. */
function MultiSelectAnswer({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.selectAnswer");
  const [selected, setSelected] = useState<number[]>([]);
  const { options } = slide;
  const inert = mode === "preview";
  const locked = submitting || inert;

  const toggle = (i: number) => setSelected((prev) => toggled(prev, i));

  // Keyboard shortcuts while focus is in the list: 1-9 or A-Z toggle an option.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const option = shortcutOption(e, options.length);
    if (option !== null) setSelected((prev) => toggled(prev, option));
  };

  return (
    <div className="space-y-4 w-full">
      <p className="text-center text-sm font-medium text-deck-muted-fg" id={`select-all-${slide.slideIndex}`}>
        {t("selectAll")}
      </p>
      <div
        className="grid grid-cols-1 gap-3"
        role="group"
        aria-label={t("optionsLabel")}
        aria-describedby={`select-all-${slide.slideIndex}`}
        onKeyDown={onKeyDown}
      >
        {options.map((opt, i) => {
          const isSelected = selected.includes(i);

          return (
            <motion.button
              key={i}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              whileTap={{ scale: 0.98 }}
              onClick={() => toggle(i)}
              disabled={locked}
              className={`group relative flex w-full items-center gap-3.5 rounded-2xl border p-4 text-left font-semibold transition-all duration-300 ${
                isSelected
                  ? "border-deck-primary/70 bg-deck-primary/10 text-deck-fg ring-1 ring-deck-primary/40"
                  : "border-deck-border/60 bg-deck-surface/60 hover:border-deck-primary/40 hover:bg-deck-secondary/40 text-deck-fg/90"
              }`}
            >
              <div
                aria-hidden="true"
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg border-2 text-xs font-bold transition-all duration-300 ${
                  isSelected
                    ? "border-deck-primary bg-deck-primary text-deck-primary-fg shadow-sm"
                    : "border-deck-border bg-deck-secondary text-deck-muted-fg group-hover:border-deck-primary/40 group-hover:text-deck-fg"
                }`}
              >
                {isSelected ? <Check className="size-4" strokeWidth={3} /> : String.fromCharCode(65 + i)}
              </div>
              <span className="text-base font-semibold leading-snug break-words min-w-0">{opt.text}</span>
            </motion.button>
          );
        })}
      </div>

      <SubmitButton
        label={t("submit")}
        submitting={submitting}
        disabled={locked || selected.length === 0}
        onClick={() =>
          selected.length > 0 && onSubmit({ payload: { optionIndices: [...selected].sort((a, b) => a - b) } })
        }
      />
    </div>
  );
}

function SubmitButton({
  label,
  submitting,
  disabled,
  onClick,
}: {
  label: string;
  submitting: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md hover:shadow-lg transition-all"
    >
      {submitting ? (
        <SendingSpinner />
      ) : (
        <span className="flex items-center gap-2">
          {label} <Send className="size-4" aria-hidden="true" />
        </span>
      )}
    </Button>
  );
}
