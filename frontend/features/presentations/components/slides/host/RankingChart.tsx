"use client";

import { motion } from "framer-motion";

interface RankedItem {
  text: string;
  points: number;
  rank: number;
}

interface RankingChartProps {
  items: RankedItem[];
  totalParticipants?: number;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function RankingChart({ items, totalParticipants = 0 }: RankingChartProps) {
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-white/40 font-medium">
        Waiting for rankings…
      </div>
    );
  }

  const maxPointsReceived = Math.max(...items.map((it) => it.points), 0);
  const maxScale = Math.max(totalParticipants * items.length, maxPointsReceived, 10);

  return (
    <div className="space-y-2.5 w-full">
      {items.map((it, i) => {
        const barWidthPct = maxPointsReceived > 0 ? Math.min(100, Math.round((it.points / maxScale) * 100)) : 0;

        return (
          <div key={i} className="flex items-center gap-3 w-full">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-amber-400/10 text-xs font-bold text-amber-300 tabular-nums">
              #{it.rank}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-white/90 truncate">{it.text}</span>
                <span className="text-xs font-mono text-white/50 ml-2 shrink-0">
                  {it.points} pts
                </span>
              </div>

              <div className="h-3 w-full rounded-full overflow-hidden bg-white/[0.02]">
                {barWidthPct > 0 && (
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.4)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${barWidthPct}%` }}
                    transition={{ duration: 0.6, ease }}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
