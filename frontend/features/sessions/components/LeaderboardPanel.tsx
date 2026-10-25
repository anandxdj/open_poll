"use client";

import { useState } from "react";
import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
  correctCount: number;
}

const PREVIEW_ROWS = 10;
const rankTone = ["text-deck-rank-1", "text-deck-rank-2", "text-deck-rank-3"];

/** Standings of a finished session: the top 10, expandable to every ranked entry. */
export function LeaderboardPanel({ rows }: { rows: LeaderboardRow[] }) {
  const t = useTranslations("sessions.report.leaderboard");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <section aria-labelledby="leaderboard-title" className="rounded-[2rem] border border-border bg-card p-6">
      <h2 id="leaderboard-title" className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight">
        <Trophy className="size-4 text-primary" /> {t("title")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <ol className="divide-y divide-border/60">
            {shown.map((row) => (
              <li key={`${row.rank}-${row.name}`} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={cn("w-8 shrink-0 text-center font-mono text-xs font-bold", rankTone[row.rank - 1] ?? "text-muted-foreground")}>
                  #{row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold text-foreground/90">{row.name}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{t("correct", { count: row.correctCount })}</span>
                <span className="w-24 shrink-0 text-right text-xs font-bold tabular-nums">{t("points", { score: row.score.toLocaleString() })}</span>
              </li>
            ))}
          </ol>
          {rows.length > PREVIEW_ROWS ? (
            <Button variant="ghost" size="sm" className="mt-3 rounded-xl" onClick={() => setExpanded((open) => !open)}>
              {expanded ? t("showLess") : t("showAll", { count: rows.length })}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
