"use client";

import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

interface AnswerEntry {
  text: string;
  count: number;
  isCorrect: boolean;
}

interface TypeAnswerChartProps {
  answers: AnswerEntry[];
  isReveal: boolean;
  totalParticipants?: number;
}

const ease = [0.32, 0.72, 0, 1] as const;

export function TypeAnswerChart({ answers, isReveal, totalParticipants = 0 }: TypeAnswerChartProps) {
  if (!answers || answers.length === 0) {
    return (
      <div className="text-center py-6 text-xs text-white/40 font-medium">
        No answers received yet
      </div>
    );
  }

  const totalVotes = answers.reduce((sum, a) => sum + a.count, 0);
  const maxScale = Math.max(totalParticipants, totalVotes, 10);

  return (
    <div className="space-y-2.5 w-full">
      {answers.map((ans, i) => {
        const barWidthPct = totalVotes > 0 ? Math.min(100, Math.round((ans.count / maxScale) * 100)) : 0;
        const isCorrectAnswer = isReveal && ans.isCorrect;

        return (
          <div key={i} className="flex items-center gap-3 w-full">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-sm font-semibold truncate flex items-center gap-2 ${
                    isCorrectAnswer ? "text-emerald-400 font-bold" : "text-white/85"
                  }`}
                >
                  {ans.text}
                  {isCorrectAnswer && <CheckCircle2 className="size-4 text-emerald-400 shrink-0 inline" />}
                </span>
                <span className="text-xs font-mono text-white/60 ml-2 shrink-0">
                  {ans.count} response{ans.count !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="h-3 w-full rounded-full overflow-hidden bg-white/[0.02]">
                {barWidthPct > 0 && (
                  <motion.div
                    className={`h-full rounded-full ${
                      isCorrectAnswer
                        ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.4)]"
                        : "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
                    }`}
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
