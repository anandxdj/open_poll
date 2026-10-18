"use client";

import { motion } from "framer-motion";
import type { RevealDistribution } from "../../../types";
import type { StageViewProps } from "../../runtime";
import { ease } from "../../shared";

/** Combined ranking: items by points, with a bar each. */
export function RankingStage({ slide, live, reveal, participants, mode }: StageViewProps) {
  const dist: RevealDistribution | null =
    mode === "thumbnail"
      ? {
          kind: "ranking",
          items: slide.items.map((text, i) => ({ text, points: 0, rank: i + 1 })),
          voters: 0,
        }
      : (live.distribution ?? reveal?.distribution ?? null);
  if (dist?.kind !== "ranking") return null;

  const maxPoints = Math.max(...dist.items.map((it) => it.points), 0);
  const maxScale = Math.max(participants.length * dist.items.length, maxPoints, 10);

  return (
    <div className="pt-2 max-h-[55vh] overflow-y-auto">
      <div className="space-y-2.5 w-full font-sans">
        {dist.items.map((it, i) => {
          const barWidthPct = maxPoints > 0 ? Math.min(100, Math.round((it.points / maxScale) * 100)) : 0;

          return (
            <div
              key={i}
              className="flex items-center justify-between gap-4 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/5 p-3.5"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-deck-accent/20 text-xs font-bold text-deck-accent-soft border border-deck-accent/30">
                  #{it.rank}
                </span>
                <span className="text-sm sm:text-base font-semibold text-deck-stage-fg truncate">{it.text}</span>
              </div>

              <div className="flex items-center gap-3 shrink-0 w-44 sm:w-56">
                <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-deck-stage-fg/10 border border-deck-stage-fg/10 p-0.5">
                  {barWidthPct > 0 && (
                    <motion.div
                      className="h-full rounded-full bg-deck-accent-strong"
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidthPct}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                  )}
                </div>
                <span className="font-mono text-xs font-semibold text-deck-stage-fg/60 shrink-0 min-w-[44px] text-right">
                  {it.points} pts
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
