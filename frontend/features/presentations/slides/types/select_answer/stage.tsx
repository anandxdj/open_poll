"use client";

import { motion } from "framer-motion";
import { Lightbulb } from "lucide-react";
import type { RevealDistribution } from "../../../types";
import type { StageViewProps } from "../../runtime";
import { ease, isRevealMode } from "../../shared";
import { isGradedSelectAnswer, selectAnswerConfig } from "./config";

type OptionsDistribution = Extract<RevealDistribution, { kind: "options" }>;

/**
 * Vertical bar per option. On reveal the correct ones light up (graded slides
 * only: an ungraded one just shows its results) and the explanation appears.
 */
export function SelectAnswerStage({ slide, live, reveal, participants, mode }: StageViewProps) {
  const dist =
    mode === "thumbnail"
      ? ({ kind: "options", counts: slide.options.map(() => 0), options: slide.options } as const)
      : (live.distribution ?? reveal?.distribution ?? null);
  if (dist?.kind !== "options") return null;
  const { allowMultiple, explanation } = selectAnswerConfig(slide);
  const isReveal = isRevealMode(mode);
  return (
    <div className="pt-2 max-h-[55vh] overflow-y-auto">
      {allowMultiple && (
        <p className="text-center text-sm font-medium text-deck-stage-fg/60">
          Multiple answers allowed
        </p>
      )}
      <OptionColumns
        dist={dist}
        isReveal={isReveal}
        graded={isGradedSelectAnswer(slide)}
        // A multi-select answer counts once per pick, so shares are of respondents.
        respondents={allowMultiple ? Math.max(live.answeredCount, reveal?.answeredCount ?? 0) : null}
        totalParticipants={participants.length}
      />
      {isReveal && explanation.trim() && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease }}
          className="mx-auto mt-4 flex max-w-2xl items-start gap-3 rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/[0.03] px-5 py-4 text-left"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-deck-accent" />
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium text-deck-stage-fg/60">
              Explanation
            </p>
            <p className="text-sm sm:text-base leading-relaxed text-deck-stage-fg/80whitespace-pre-line break-words">
              {explanation.trim()}
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}

function OptionColumns({
  dist,
  isReveal,
  graded,
  respondents,
  totalParticipants,
}: {
  dist: OptionsDistribution;
  isReveal: boolean;
  graded: boolean;
  /** Multi-select: people who answered (shares are of them); null for single-select. */
  respondents: number | null;
  totalParticipants: number;
}) {
  const totalVotes = dist.counts.reduce((a, b) => a + b, 0);
  const shareBase = respondents ? respondents : totalVotes;
  const maxScale = Math.max(totalParticipants, respondents ?? totalVotes, 10);
  const numOptions = dist.options.length;
  // Revealed results of an ungraded slide stay neutral: nothing correct, nothing dimmed.
  const markCorrect = isReveal && graded;

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
          const sharePct = shareBase > 0 ? Math.min(100, Math.round((count / shareBase) * 100)) : 0;
          const barHeightPct = totalVotes > 0 ? Math.min(100, Math.round((count / maxScale) * 100)) : 0;
          const isCorrect = markCorrect && opt.isCorrect;

          return (
            <div key={i} className="flex flex-col items-center justify-end h-full space-y-3 group">
              {/* Count and share above the column */}
              <div className="flex flex-col items-center space-y-1 min-h-[32px] justify-end">
                <div className="font-mono text-center">
                  <span className="text-base sm:text-lg font-bold text-deck-stage-fg leading-none">
                    {count}
                  </span>
                  <span className="block text-sm font-medium text-deck-stage-fg/60 leading-none mt-0.5">
                    {sharePct}%
                  </span>
                </div>
              </div>

              {/* Column track */}
              <div
                className={`relative w-full max-w-[90px] sm:max-w-[110px] h-[160px] sm:h-[200px] rounded-2xl border p-1.5 flex items-end justify-center overflow-hidden transition-all duration-300 ${
                  isCorrect
                    ? "border-deck-correct/50 bg-deck-correct-deep/20 shadow-[0_0_24px_color-mix(in_srgb,var(--deck-glow-correct)_20%,transparent)]"
                    : markCorrect
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
                  className={`flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold ${
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
