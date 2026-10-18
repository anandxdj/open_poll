"use client";

import { motion } from "framer-motion";
import type { RevealDistribution } from "../../../types";
import type { StageViewProps } from "../../runtime";
import { ease } from "../../shared";

/** Average rating per statement as a bar out of the scale maximum. */
export function ScalesStage({ slide, live, reveal, mode }: StageViewProps) {
  const dist: RevealDistribution | null =
    mode === "thumbnail"
      ? {
          kind: "scales",
          statements: slide.statements.map((statement) => ({ statement, average: 0, count: 0 })),
          scaleMax: slide.scaleMax,
          minLabel: slide.minLabel,
          maxLabel: slide.maxLabel,
        }
      : (live.distribution ?? reveal?.distribution ?? null);
  if (dist?.kind !== "scales") return null;
  return (
    <div className="pt-2 max-h-[55vh] overflow-y-auto">
      <div className="space-y-3.5 w-full font-sans">
        {dist.statements.map((s, i) => {
          const pct = Math.round((s.average / dist.scaleMax) * 100);

          return (
            <div
              key={i}
              className="flex items-center justify-between gap-4 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/5 p-4"
            >
              <span className="text-sm sm:text-base font-semibold text-deck-stage-fg/90 truncate flex-1 min-w-0">
                {s.statement}
              </span>
              <div className="flex items-center gap-3 shrink-0 w-44 sm:w-60">
                <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-deck-stage-fg/10 border border-deck-stage-fg/10 p-0.5">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-deck-accent-strong to-deck-accent"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease }}
                  />
                </div>
                <span className="text-sm font-mono font-bold text-deck-accent shrink-0 min-w-[50px] text-right">
                  {s.average.toFixed(1)} <span className="text-deck-stage-fg/40 font-normal">/ {dist.scaleMax}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
