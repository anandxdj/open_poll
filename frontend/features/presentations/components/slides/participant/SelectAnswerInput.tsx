"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SelectAnswerInputProps {
  options: { text: string }[];
  selectedOption: number | null;
  onSelectOption: (index: number) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function SelectAnswerInput({
  options,
  selectedOption,
  onSelectOption,
  onSubmit,
  submitting,
}: SelectAnswerInputProps) {
  // Keyboard shortcuts: 1-9 or A-Z to select option
  useEffect(() => {
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
        onSelectOption(num - 1);
      } else if (key.length === 1 && key >= "A" && key.charCodeAt(0) - 65 < options.length) {
        onSelectOption(key.charCodeAt(0) - 65);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options.length, onSelectOption, submitting]);

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
              onClick={() => onSelectOption(i)}
              disabled={submitting}
              className={`group relative flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left font-semibold transition-all duration-300 ${
                isSelected
                  ? "border-primary/70 bg-primary/10 text-foreground shadow-[0_0_25px_rgba(216,173,135,0.15)] ring-1 ring-primary/40"
                  : "border-border/60 bg-card/60 hover:border-primary/40 hover:bg-secondary/40 text-foreground/90"
              }`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold transition-all duration-300 ${
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-secondary text-muted-foreground/80 group-hover:border-primary/40 group-hover:text-foreground"
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
                  <CheckCircle2 className="size-5 shrink-0 text-primary" />
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>

      <Button
        onClick={onSubmit}
        disabled={submitting || selectedOption === null}
        className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md hover:shadow-lg transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            Submit Answer <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
