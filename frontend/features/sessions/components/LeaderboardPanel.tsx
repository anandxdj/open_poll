"use client";

import { useState } from "react";
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
import { SectionTitle } from "./ui";

/** Standings of a finished session: the top 10, expandable to every ranked entry. */
export function LeaderboardPanel({ rows }: { rows: LeaderboardRow[] }) {
  const t = useTranslations("sessions.report.leaderboard");
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, PREVIEW_ROWS);

  return (
    <section aria-labelledby="leaderboard-title" className="space-y-4">
      <SectionTitle id="leaderboard-title">{t("title")}</SectionTitle>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {shown.map((row) => (
              <li key={`${row.rank}-${row.name}`} className="flex items-center gap-4 px-5 py-3.5 text-sm">
                <span
                  className={cn(
                    "w-7 shrink-0 font-mono tabular-nums",
                    row.rank === 1 ? "text-accent-ink" : "text-muted-foreground"
                  )}
                >
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">{row.name}</span>
                <span className="hidden text-muted-foreground sm:inline">{t("correct", { count: row.correctCount })}</span>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums text-foreground">
                  {t("points", { score: row.score.toLocaleString() })}
                </span>
              </li>
            ))}
          </ol>
          {rows.length > PREVIEW_ROWS ? (
            <Button variant="outline" size="sm" className="bg-card" onClick={() => setExpanded((open) => !open)}>
              {expanded ? t("showLess") : t("showAll", { count: rows.length })}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}
