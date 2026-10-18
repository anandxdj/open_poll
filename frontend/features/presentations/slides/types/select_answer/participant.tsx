"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ParticipantViewProps } from "../../runtime";

export function SelectAnswerParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.selectAnswer");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const { options } = slide;
  const inert = mode === "preview";
  const locked = submitting || inert;

  // Keyboard shortcuts: 1-9 or A-Z to select option
  useEffect(() => {
    if (inert) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        submitting
      ) {
        return;
      }
      const key = e.key.toUpperCase();
      const num = parseInt(key, 10);

      if (!isNaN(num) && num >= 1 && num <= options.length) {
        setSelectedOption(num - 1);
      } else if (key.length === 1 && key >= "A" && key.charCodeAt(0) - 65 < options.length) {
        setSelectedOption(key.charCodeAt(0) - 65);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options.length, submitting, inert]);

  return (
    <div className="space-y-4 w-full">
      <div className="grid grid-cols-1 gap-3">
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
              className={`group relative flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left font-semibold transition-all duration-300 ${
                isSelected
                  ? "border-deck-primary/70 bg-deck-primary/10 text-deck-fg shadow-[0_0_25px_color-mix(in_srgb,var(--deck-primary)_15%,transparent)] ring-1 ring-deck-primary/40"
                  : "border-deck-border/60 bg-deck-surface/60 hover:border-deck-primary/40 hover:bg-deck-secondary/40 text-deck-fg/90"
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-all duration-300 ${
                    isSelected
                      ? "border-deck-primary bg-deck-primary text-deck-primary-fg shadow-sm"
                      : "border-deck-border bg-deck-secondary text-deck-muted-fg/80 group-hover:border-deck-primary/40 group-hover:text-deck-fg"
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
                  <CheckCircle2 className="size-5 shrink-0 text-deck-primary" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      <Button
        onClick={() => selectedOption !== null && onSubmit({ optionIndex: selectedOption })}
        disabled={locked || selectedOption === null}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md hover:shadow-lg transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
