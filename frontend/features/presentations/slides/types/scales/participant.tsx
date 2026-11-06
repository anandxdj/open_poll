"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ParticipantViewProps } from "../../runtime";
import { SendingSpinner } from "../../SendingSpinner";

export function ScalesParticipant({ slide, mode, onSubmit, submitting }: ParticipantViewProps) {
  const t = useTranslations("live.slides.scales");
  const { statements, scaleMax, minLabel, maxLabel } = slide;
  // Every slider starts mid-scale, so an untouched slider still submits a rating.
  const [ratings, setRatings] = useState<number[]>(() =>
    (statements ?? []).map(() => Math.ceil((scaleMax || 5) / 2))
  );
  const locked = submitting || mode === "preview";

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
              className="rounded-2xl border border-deck-border/60 bg-deck-surface/60 p-4 space-y-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold leading-snug">{statement}</p>
                <div
                  aria-hidden="true"
                  className="size-7 rounded-xl bg-deck-primary/15 border border-deck-primary/30 flex items-center justify-center text-deck-primary-ink text-xs font-extrabold shrink-0 tabular-nums"
                >
                  {currentVal}
                </div>
              </div>

              <input
                type="range"
                min={1}
                max={scaleMax}
                step={1}
                value={currentVal}
                disabled={locked}
                aria-label={statement}
                // "4 of 5 (Disagree 1, Agree 5)": the value with what the ends mean (W4-A).
                aria-valuetext={t("valueText", {
                  value: currentVal,
                  max: scaleMax,
                  minLabel: minLabel || t("minLabel"),
                  maxLabel: maxLabel || t("maxLabel"),
                })}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  setRatings((prev) => prev.map((r, j) => (j === i ? value : r)));
                }}
                // 44 px tall touch target; the browser still draws a thin track.
                className="w-full h-11 cursor-pointer bg-transparent accent-deck-primary"
              />

              <div className="flex justify-between text-xs font-medium text-deck-muted-fg">
                <span>{minLabel || t("minLabel")}</span>
                <span>{maxLabel || t("maxLabel")}</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <Button
        onClick={() => onSubmit({ ratings })}
        disabled={locked}
        className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-bold text-base shadow-md transition-all"
      >
        {submitting ? (
          <SendingSpinner />
        ) : (
          <span className="flex items-center gap-2">
            {t("submit")} <Send className="size-4" aria-hidden="true" />
          </span>
        )}
      </Button>
    </div>
  );
}
