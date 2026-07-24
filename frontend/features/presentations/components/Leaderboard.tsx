"use client";

import { motion } from "framer-motion";
import { Crown, Medal, Trophy } from "lucide-react";
import type { LeaderboardEntry } from "../types";

const ease = [0.32, 0.72, 0, 1] as const;

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  highlightParticipantId?: string;
  title?: string;
}

const rankIcon = (rank: number) => {
  if (rank === 1) return <Crown className="size-4 text-yellow-400" />;
  if (rank === 2) return <Medal className="size-4 text-zinc-300" />;
  if (rank === 3) return <Medal className="size-4 text-amber-600" />;
  return null;
};

export function Leaderboard({ entries, highlightParticipantId, title = "Leaderboard" }: LeaderboardProps) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground/50">
        No scores yet — waiting for the first answers.
      </div>
    );
  }

  const maxScore = Math.max(...entries.map((e) => e.score), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="size-4 text-primary" />
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
          {title}
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
              className={`relative overflow-hidden rounded-2xl border px-4 py-3 flex items-center gap-3 ${
                isMe
                  ? "border-primary/40 bg-primary/10"
                  : entry.rank === 1
                    ? "border-yellow-400/30 bg-yellow-400/5"
                    : "border-white/10 bg-white/[0.03]"
              }`}
            >
              {/* score bar backdrop */}
              <div
                className="absolute inset-y-0 left-0 bg-primary/[0.06]"
                style={{ width: `${(entry.score / maxScore) * 100}%` }}
              />
              <span className="relative z-10 w-7 text-center text-sm font-bold tabular-nums text-muted-foreground/60">
                {entry.rank}
              </span>
              <span className="relative z-10 flex-1 flex items-center gap-2 text-sm font-semibold text-foreground/90 truncate">
                {entry.name}
                {isMe && (
                  <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                    You
                  </span>
                )}
                {rankIcon(entry.rank)}
              </span>
              <span className="relative z-10 text-sm font-bold tabular-nums text-primary">
                {entry.score.toLocaleString()}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
