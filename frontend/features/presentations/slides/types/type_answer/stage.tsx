"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import type { RevealDistribution } from "../../../types";
import type { StageViewProps } from "../../runtime";
import { ease, isRevealMode } from "../../shared";

type TextDistribution = Extract<RevealDistribution, { kind: "text" }>;

/** Grouped free-text answers with a bar each; accepted answers turn green on reveal. */
export function TypeAnswerStage({ slide, live, reveal, participants, mode }: StageViewProps) {
  const dist: RevealDistribution | null =
    mode === "thumbnail"
      ? {
          kind: "text",
          answers: slide.acceptedAnswers.map((text) => ({ text, count: 0, isCorrect: true })),
          acceptedAnswers: slide.acceptedAnswers,
        }
      : (live.distribution ?? reveal?.distribution ?? null);
  if (dist?.kind !== "text") return null;
  return (
    <div className="pt-2 max-h-[55vh] overflow-y-auto">
      <AnswerBars dist={dist} isReveal={isRevealMode(mode)} totalParticipants={participants.length} />
    </div>
  );
}

function AnswerBars({
  dist,
  isReveal,
  totalParticipants,
}: {
  dist: TextDistribution;
  isReveal: boolean;
  totalParticipants: number;
}) {
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
              isCorrect
                ? "border-deck-correct/50 bg-deck-correct-deep/20"
                : "border-deck-stage-fg/10 bg-deck-stage-fg/5"
            }`}
          >
            <span
              className={`text-sm sm:text-base font-semibold truncate flex items-center gap-2 flex-1 min-w-0 ${
                isCorrect ? "text-deck-correct-soft" : "text-deck-stage-fg/90"
              }`}
            >
              {a.text}
              {isCorrect && <CheckCircle2 className="size-4 text-deck-correct-soft shrink-0" />}
            </span>

            <div className="flex items-center gap-3 shrink-0 w-44 sm:w-56">
              <div className="relative h-4 flex-1 rounded-full overflow-hidden bg-deck-stage-fg/10 border border-deck-stage-fg/10 p-0.5">
                {barWidthPct > 0 && (
                  <motion.div
                    className={`h-full rounded-full ${isCorrect ? "bg-deck-correct" : "bg-deck-bar"}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${barWidthPct}%` }}
                    transition={{ duration: 0.6, ease }}
                  />
                )}
              </div>
              <span className="font-mono text-xs font-semibold text-deck-stage-fg/60 shrink-0 min-w-[48px] text-right">
                {a.count} {a.count === 1 ? "vote" : "votes"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
