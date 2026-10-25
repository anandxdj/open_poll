"use client";

import { motion } from "framer-motion";
import { Crown, Medal, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LeaderboardEntry } from "../../types";

const ease = [0.32, 0.72, 0, 1] as const;

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  highlightParticipantId?: string;
  title?: string;
}

const rankIcon = (rank: number) => {
  if (rank === 1) return <Crown className="size-4 text-deck-rank-1" />;
  if (rank === 2) return <Medal className="size-4 text-deck-rank-2" />;
  if (rank === 3) return <Medal className="size-4 text-deck-rank-3" />;
  return null;
};

/** Ranked score list — leaderboard slides, the host's leaderboard modal and both end screens. */
export function Leaderboard({ entries, highlightParticipantId, title }: LeaderboardProps) {
  const t = useTranslations("live.leaderboard");

  if (entries.length === 0) {
    return <div className="py-10 text-center text-sm text-deck-muted-fg">{t("empty")}</div>;
  }

  const maxScore = Math.max(...entries.map((e) => e.score), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="size-4 text-deck-primary" />
        <h2 className="text-sm font-medium text-deck-muted-fg">
          {title ?? t("title")}
        </h2>
      </div>

      <div className="space-y-2">
        {entries.map((entry, i) => {
          const isMe = entry.participantId === highlightParticipantId;
          return (
            <motion.div
              key={entry.participantId}
              layout
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease, delay: i * 0.06 }}
              className={`relative flex items-center gap-3 overflow-hidden rounded-xl border px-4 py-3 ${
                isMe
                  ? "border-deck-primary/50 bg-deck-primary/10"
                  : entry.rank === 1
                    ? "border-deck-rank-1/40 bg-deck-rank-1/5"
                    : "border-deck-border bg-deck-surface"
              }`}
            >
              {/* score bar backdrop */}
              <div
                className="absolute inset-y-0 left-0 bg-deck-primary/[0.06]"
                style={{ width: `${(entry.score / maxScore) * 100}%` }}
              />
              <span className="relative z-10 w-7 text-center font-mono text-sm tabular-nums text-deck-muted-fg">
                {entry.rank}
              </span>
              <span className="relative z-10 flex flex-1 items-center gap-2 truncate text-base font-medium text-deck-fg">
                {entry.name}
                {isMe && (
                  <span className="rounded-full bg-deck-primary/15 px-2 py-0.5 text-xs font-medium text-deck-fg">
                    {t("you")}
                  </span>
                )}
                {rankIcon(entry.rank)}
              </span>
              <span className="relative z-10 font-mono text-sm font-medium tabular-nums text-deck-fg">
                {entry.score.toLocaleString()}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
