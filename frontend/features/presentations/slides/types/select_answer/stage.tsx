"use client";

import { motion } from "framer-motion";
import type { RevealDistribution } from "../../../types";
import type { StageViewProps } from "../../runtime";
import { ease, isRevealMode } from "../../shared";

type OptionsDistribution = Extract<RevealDistribution, { kind: "options" }>;

/** Vertical bar per option; the correct ones light up on reveal. */
export function SelectAnswerStage({ slide, live, reveal, participants, mode }: StageViewProps) {
  const dist =
    mode === "thumbnail"
      ? ({ kind: "options", counts: slide.options.map(() => 0), options: slide.options } as const)
      : (live.distribution ?? reveal?.distribution ?? null);
  if (dist?.kind !== "options") return null;
  return (
    <div className="pt-2 max-h-[55vh] overflow-y-auto">
      <OptionColumns dist={dist} isReveal={isRevealMode(mode)} totalParticipants={participants.length} />
    </div>
  );
}

function OptionColumns({
  dist,
  isReveal,
  totalParticipants,
}: {
  dist: OptionsDistribution;
  isReveal: boolean;
  totalParticipants: number;
}) {
  const totalVotes = dist.counts.reduce((a, b) => a + b, 0);
  const maxScale = Math.max(totalParticipants, totalVotes, 10);
  const numOptions = dist.options.length;

  return (
    <div className="w-full font-sans pt-4 pb-2">
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
              {/* Count and share above the column */}
              <div className="flex flex-col items-center space-y-1 min-h-[32px] justify-end">
                <div className="font-mono text-center">
                  <span className="text-base sm:text-lg font-bold text-deck-stage-fg leading-none">
                    {count}
                  </span>
                  <span className="block text-[11px] text-deck-stage-fg/40 font-semibold leading-none mt-0.5">
                    {sharePct}%
                  </span>
                </div>
              </div>

              {/* Column track */}
              <div
                className={`relative w-full max-w-[90px] sm:max-w-[110px] h-[160px] sm:h-[200px] rounded-2xl border p-1.5 flex items-end justify-center overflow-hidden transition-all duration-300 ${
                  isCorrect
                    ? "border-deck-correct/50 bg-deck-correct-deep/20 shadow-[0_0_24px_color-mix(in_srgb,var(--deck-glow-correct)_20%,transparent)]"
                    : isReveal
                    ? "border-deck-stage-fg/5 bg-deck-stage-fg/[0.02] opacity-40"
                    : "border-deck-stage-fg/10 bg-deck-stage-fg/5 group-hover:border-deck-stage-fg/20"
                }`}
              >
                {barHeightPct > 0 ? (
                  <motion.div
                    className={`w-full rounded-xl ${
                      isCorrect
                        ? "bg-gradient-to-t from-deck-correct to-deck-correct-alt shadow-[0_0_16px_color-mix(in_srgb,var(--deck-glow-correct)_50%,transparent)]"
                        : "bg-gradient-to-t from-deck-accent-strong to-deck-accent shadow-[0_0_12px_color-mix(in_srgb,var(--deck-glow-accent)_40%,transparent)]"
                    }`}
                    initial={{ height: 0 }}
                    animate={{ height: `${barHeightPct}%` }}
                    transition={{ duration: 0.6, ease }}
                  />
                ) : (
                  <div className="h-1 w-full rounded-full bg-deck-stage-fg/10" />
                )}
              </div>

              {/* Option label and letter badge */}
              <div className="flex flex-col items-center space-y-1.5 text-center max-w-full">
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold uppercase tracking-wider ${
                    isCorrect
                      ? "bg-deck-correct text-deck-stage-fg shadow-sm"
                      : "bg-deck-stage-fg/10 text-deck-stage-fg/90 border border-deck-stage-fg/15"
                  }`}
                >
                  {String.fromCharCode(65 + i)}
                </div>
                <span
                  className={`text-xs sm:text-sm font-semibold leading-tight line-clamp-2 ${
                    isCorrect ? "text-deck-correct-soft font-bold" : "text-deck-stage-fg/90"
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
