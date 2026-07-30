"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import type { RevealDistribution, RevealPayload } from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

interface CardFillRevealChartProps {
  distribution: RevealDistribution;
  reveal?: RevealPayload | null;
  isReveal: boolean;
  totalParticipants?: number;
}

export function CardFillRevealChart({
  distribution: dist,
  reveal,
  isReveal,
  totalParticipants = 0,
}: CardFillRevealChartProps) {
  // Option choice slides (Multiple Choice - Mentimeter Classic Vertical Bar Columns)
  if (dist.kind === "options") {
    const totalVotes = dist.counts.reduce((a, b) => a + b, 0);
    const maxScale = Math.max(totalParticipants, totalVotes, 10);
    const numOptions = dist.options.length;

    return (
      <div className="w-full font-sans pt-4 pb-2">
        {/* Vertical Columns Container */}
        <div
          className={`grid gap-4 sm:gap-6 items-end w-full min-h-[260px] sm:min-h-[320px] px-2 ${
            numOptions <= 2
              ? "grid-cols-2 max-w-xl mx-auto"
              : numOptions === 3
              ? "grid-cols-3 max-w-2xl mx-auto"
              : "grid-cols-2 sm:grid-cols-4"
          }`}
        >
          {dist.options.map((opt, i) => {
            const count = dist.counts[i] ?? 0;
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

  // Short Answer / Text responses
  if (dist.kind === "text") {
    const totalVotes = dist.answers.reduce((sum, a) => sum + a.count, 0);
    const maxScale = Math.max(totalParticipants, totalVotes, 10);

    return (
      <div className="space-y-2.5 w-full font-sans">
        {dist.answers.map((a, i) => {
          const barWidthPct = totalVotes > 0 ? Math.min(100, Math.round((a.count / maxScale) * 100)) : 0;
          const isCorrect = isReveal && a.isCorrect;

          return (
            <div
              key={i}
              className={`flex items-center justify-between gap-4 rounded-2xl border p-3.5 transition-all duration-300 ${
                isCorrect ? "border-emerald-500/50 bg-emerald-950/20" : "border-white/10 bg-white/5"
              }`}
            >
              <span className={`text-sm sm:text-base font-semibold truncate flex items-center gap-2 flex-1 min-w-0 ${isCorrect ? "text-emerald-400" : "text-white/90"}`}>
                {a.text}
                {isCorrect && <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />}
              </span>

              <div className="flex items-center gap-3 shrink-0 w-44 sm:w-56">
                <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-white/10 border border-white/10 p-0.5">
                  {barWidthPct > 0 && (
                    <motion.div
                      className={`h-full rounded-full ${isCorrect ? "bg-emerald-500" : "bg-orange-500"}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidthPct}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                  )}
                </div>
                <span className="font-mono text-xs font-semibold text-white/60 shrink-0 min-w-[48px] text-right">
                  {a.count} {a.count === 1 ? "vote" : "votes"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (dist.kind === "responses") {
    return (
      <div className="flex flex-wrap gap-2.5 justify-center font-sans">
        {dist.responses.map((r, i) => (
          <span
            key={i}
            className="rounded-2xl bg-white/10 border border-white/15 px-4 py-2 text-sm font-semibold text-white/90 shadow-sm"
          >
            {r.text}
            {r.count > 1 && (
              <span className="ml-2 font-mono text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                ×{r.count}
              </span>
            )}
          </span>
        ))}
      </div>
    );
  }

  if (dist.kind === "scales") {
    return (
      <div className="space-y-3.5 w-full font-sans">
        {dist.statements.map((s, i) => {
          const pct = Math.round((s.average / dist.scaleMax) * 100);

          return (
            <div key={i} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <span className="text-sm sm:text-base font-semibold text-white/90 truncate flex-1 min-w-0">{s.statement}</span>
              <div className="flex items-center gap-3 shrink-0 w-44 sm:w-60">
                <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-white/10 border border-white/10 p-0.5">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease }}
                  />
                </div>
                <span className="text-sm font-mono font-bold text-amber-400 shrink-0 min-w-[50px] text-right">
                  {s.average.toFixed(1)} <span className="text-white/40 font-normal">/ {dist.scaleMax}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  if (dist.kind === "ranking") {
    const maxPoints = Math.max(...dist.items.map((it) => it.points), 0);
    const maxScale = Math.max(totalParticipants * dist.items.length, maxPoints, 10);

    return (
      <div className="space-y-2.5 w-full font-sans">
        {dist.items.map((it, i) => {
          const barWidthPct = maxPoints > 0 ? Math.min(100, Math.round((it.points / maxScale) * 100)) : 0;

          return (
            <div key={i} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-3.5">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-xs font-bold text-amber-300 border border-amber-400/30">
                  #{it.rank}
                </span>
                <span className="text-sm sm:text-base font-semibold text-white truncate">{it.text}</span>
              </div>

              <div className="flex items-center gap-3 shrink-0 w-44 sm:w-56">
                <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-white/10 border border-white/10 p-0.5">
                  {barWidthPct > 0 && (
                    <motion.div
                      className="h-full rounded-full bg-amber-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${barWidthPct}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                  )}
                </div>
                <span className="font-mono text-xs font-semibold text-white/60 shrink-0 min-w-[44px] text-right">
                  {it.points} pts
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}
