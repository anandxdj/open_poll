"use client";

import { motion } from "framer-motion";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ScalesInputProps {
  statements: string[];
  ratings: number[];
  onRatingChange: (statementIndex: number, value: number) => void;
  scaleMax: number;
  minLabel: string;
  maxLabel: string;
  onSubmit: () => void;
  submitting: boolean;
}

export function ScalesInput({
  statements,
  ratings,
  onRatingChange,
  scaleMax,
  minLabel,
  maxLabel,
  onSubmit,
  submitting,
}: ScalesInputProps) {
  return (
    <div className="space-y-6 w-full">
      <div className="space-y-4">
        {statements.map((statement, i) => {
          const currentVal = ratings[i] ?? Math.ceil(scaleMax / 2);

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border border-border/60 bg-card/60 p-4 space-y-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{statement}</p>
                <div className="size-7 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary text-xs font-extrabold shrink-0 tabular-nums">
                  {currentVal}
                </div>
              </div>

              <input
                type="range"
                min={1}
                max={scaleMax}
                step={1}
                value={currentVal}
                disabled={submitting}
                onChange={(e) => onRatingChange(i, Number(e.target.value))}
                className="w-full h-2 rounded-lg accent-primary bg-secondary cursor-pointer"
              />

              <div className="flex justify-between text-[11px] font-medium text-muted-foreground/80">
                <span>{minLabel || "Strongly Disagree"}</span>
                <span>{maxLabel || "Strongly Agree"}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <Button
        onClick={onSubmit}
        disabled={submitting}
        className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            Submit Ratings <Send className="size-4" />
          </span>
        )}
      </Button>
    </div>
  );
}
