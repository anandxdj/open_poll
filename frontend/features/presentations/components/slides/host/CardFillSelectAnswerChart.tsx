"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

interface OptionCount {
  text: string;
  isCorrect: boolean;
}

interface CardFillSelectAnswerChartProps {
  options: OptionCount[];
  counts: number[];
  isReveal: boolean;
  totalParticipants?: number;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function CardFillSelectAnswerChart({
  options,
  counts,
  isReveal,
  totalParticipants = 0,
}: CardFillSelectAnswerChartProps) {
  const totalVotes = counts.reduce((a, b) => a + b, 0);
  const maxScale = Math.max(totalParticipants, totalVotes, 10);
  const numOptions = options.length;

  return (
    <div className="w-full font-sans pt-4 pb-2">
      {/* Vertical Columns Grid */}
      <div
        className={`grid gap-4 sm:gap-6 items-end w-full min-h-[260px] sm:min-h-[320px] px-2 ${
          numOptions <= 2
            ? "grid-cols-2 max-w-xl mx-auto"
            : numOptions === 3
            ? "grid-cols-3 max-w-2xl mx-auto"
            : "grid-cols-2 sm:grid-cols-4"
        }`}
      >
        {options.map((opt, i) => {
          const count = counts[i] ?? 0;
          const sharePct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const barHeightPct = totalVotes > 0 ? Math.min(100, Math.round((count / maxScale) * 100)) : 0;
          const isCorrect = isReveal && opt.isCorrect;

          return (
            <div key={i} className="flex flex-col items-center justify-end h-full space-y-3 group">
              {/* Top Stat Counter floating above column */}
              <div className="flex flex-col items-center space-y-1 min-h-[32px] justify-end">
                <div className="font-mono text-center">
                  <span className="text-base sm:text-lg font-bold text-white leading-none">
                    {count}
                  </span>
                  <span className="block text-[11px] text-white/40 font-semibold leading-none mt-0.5">
                    {sharePct}%
                  </span>
                </div>
              </div>

              {/* Vertical Column Bar Track */}
              <div
                className={`relative w-full max-w-[90px] sm:max-w-[110px] h-[160px] sm:h-[200px] rounded-2xl border p-1.5 flex items-end justify-center overflow-hidden transition-all duration-300 ${
                  isCorrect
                    ? "border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_24px_rgba(16,185,129,0.2)]"
                    : isReveal
                    ? "border-white/5 bg-white/[0.02] opacity-40"
                    : "border-white/10 bg-white/5 group-hover:border-white/20"
                }`}
              >
                {barHeightPct > 0 ? (
                  <motion.div
                    className={`w-full rounded-xl ${
                      isCorrect
                        ? "bg-gradient-to-t from-emerald-500 to-teal-400 shadow-[0_0_16px_rgba(16,185,129,0.5)]"
                        : "bg-gradient-to-t from-amber-500 to-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.4)]"
                    }`}
                    initial={{ height: 0 }}
                    animate={{ height: `${barHeightPct}%` }}
                    transition={{ duration: 0.6, ease }}
                  />
                ) : (
                  <div className="h-1 w-full rounded-full bg-white/10" />
                )}
              </div>

              {/* Bottom Option Label & Letter Badge */}
              <div className="flex flex-col items-center space-y-1.5 text-center max-w-full">
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold uppercase tracking-wider ${
                    isCorrect
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "bg-white/10 text-white/90 border border-white/15"
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </div>
                <span
                  className={`text-xs sm:text-sm font-semibold leading-tight line-clamp-2 ${
                    isCorrect ? "text-emerald-400 font-bold" : "text-white/90"
                  }`}
                >
                  {opt.text}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
