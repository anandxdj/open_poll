"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import type { SlideResultsView } from "../../../types";

/** Share of `count` in `total`, as a whole percent (0 when nobody answered). */
const share = (count: number, total: number) => (total > 0 ? Math.round((count / total) * 100) : 0);

interface Row {
  text: string;
  count: number;
  label: string;
  percent: number;
  correct?: boolean;
}

/** Rows of the result kinds a phone can draw; null for kinds only the stage draws. */
function rowsOf(results: SlideResultsView): Row[] | null {
  const d = results.distribution as Record<string, unknown> & { kind?: string };
  switch (d.kind) {
    case "options": {
      const counts = (d.counts as number[] | undefined) ?? [];
      const options = (d.options as { text: string; isCorrect: boolean }[] | undefined) ?? [];
      const total = counts.reduce((sum, n) => sum + n, 0);
      return options.map((option, i) => {
        const count = counts[i] ?? 0;
        return { text: option.text, count, label: String(count), percent: share(count, total), correct: option.isCorrect };
      });
    }
    case "words":
    case "responses":
    case "text": {
      const list = ((d.words ?? d.responses ?? d.answers) as { text: string; count: number; isCorrect?: boolean }[] | undefined) ?? [];
      const top = [...list].sort((a, b) => b.count - a.count).slice(0, 8);
      const max = top[0]?.count ?? 0;
      return top.map((entry) => ({
        text: entry.text,
        count: entry.count,
        label: String(entry.count),
        percent: share(entry.count, max),
        correct: entry.isCorrect,
      }));
    }
    case "scales": {
      const statements = (d.statements as { statement: string; average: number; count: number }[] | undefined) ?? [];
      const scaleMax = Number(d.scaleMax ?? 5) || 5;
      return statements.map((s) => ({
        text: s.statement,
        count: s.count,
        label: s.average.toFixed(1),
        percent: share(s.average, scaleMax),
      }));
    }
    case "ranking": {
      const items = (d.items as { text: string; points: number; rank: number }[] | undefined) ?? [];
      const max = Math.max(0, ...items.map((item) => item.points));
      return [...items]
        .sort((a, b) => a.rank - b.rank)
        .map((item) => ({ text: `${item.rank}. ${item.text}`, count: item.points, label: String(item.points), percent: share(item.points, max) }));
    }
    default:
      return null;
  }
}

/**
 * A slide's results on the participant's phone (audience pace, W2-F): bars for
 * choices, top words and answers, scale averages, rankings. Correct options are
 * marked only when the server sent them as correct (graded slides, once the
 * participant's result is final). Other result kinds show the response count.
 */
export function AudienceResults({ results }: { results: SlideResultsView }) {
  const t = useTranslations("live.audience");
  const rows = rowsOf(results);
  return (
    <section aria-label={t("results")} className="space-y-3 rounded-2xl border border-deck-border bg-deck-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("results")}</h3>
        <span className="text-xs tabular-nums text-deck-muted-fg">{t("resultsResponses", { count: results.answeredCount })}</span>
      </div>
      {rows && rows.length > 0 ? (
        <ul className="space-y-2.5">
          {rows.map((row, i) => (
            <li key={`${row.text}:${i}`} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  {row.correct ? <Check className="size-4 shrink-0 text-success" aria-label={t("correct")} /> : null}
                  <span className="truncate">{row.text}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-deck-muted-fg">{row.label}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-deck-secondary" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${row.correct ? "bg-success" : "bg-deck-primary"}`}
                  style={{ width: `${row.percent}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
