"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { LiveParticipant } from "@/features/presentations/types/live";
import { usePublicResults } from "../hooks/usePublicResults";
import type { PublicResults } from "../types";
import { formatDate, publicSlides } from "../query";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { SlideResultCard } from "./SlideResultCard";
import { MessageCard, Skeleton, StatTile } from "./ui";

/** Charts only need the headcount: names are never sent unless the owner chose to. */
const MAX_PLACEHOLDERS = 10_000;

/** `/r/[token]`: the aggregated results of a shared session. No account, no private data. */
export function PublicResultsView({ token }: { token: string }) {
  const t = useTranslations("sessions.public");
  const { results, loading, error, reload } = usePublicResults(token);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 md:px-6">
        {loading ? (
          <div role="status" aria-label={t("loading")} className="space-y-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-96" />
          </div>
        ) : error || !results ? (
          <MessageCard
            tone={error === "failed" ? "error" : "neutral"}
            title={error === "failed" ? t("loadFailed") : t("unavailableTitle")}
            hint={error === "failed" ? undefined : t("unavailableHint")}
          >
            {error === "failed" ? (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={reload}>
                <RefreshCw /> {t("retry")}
              </Button>
            ) : null}
          </MessageCard>
        ) : (
          <PublicResultsContent results={results} />
        )}
        <p className="pt-4 text-center text-xs text-muted-foreground/70">{t("poweredBy")}</p>
      </main>
    </div>
  );
}

/** The shared results themselves; the page around it handles loading and unavailable links. */
export function PublicResultsContent({ results }: { results: PublicResults }) {
  const t = useTranslations("sessions.public");
  const headcount = useMemo<LiveParticipant[]>(
    () =>
      Array.from({ length: Math.min(results.participantCount, MAX_PLACEHOLDERS) }, (_, i) => ({
        participantId: String(i),
        name: "",
      })),
    [results.participantCount]
  );
  const slides = useMemo(() => publicSlides(results.slides), [results.slides]);

  return (
    <>
        <header className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">{t("kicker")}</p>
          <h1 className="text-3xl font-extrabold tracking-tight">{results.title}</h1>
          <p className="text-sm text-muted-foreground">
            {t("run", { number: results.runNumber })} · {formatDate(results.startedAt)}
          </p>
        </header>
        <dl className="grid grid-cols-3 gap-3">
          <StatTile label={t("stats.participants")} value={results.participantCount.toLocaleString()} />
          <StatTile label={t("stats.responses")} value={results.answerCount.toLocaleString()} />
          <StatTile label={t("stats.date")} value={<span className="text-sm">{formatDate(results.endedAt ?? results.startedAt)}</span>} />
        </dl>

        {slides.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          slides.map((slide) => (
            <SlideResultCard
              key={slide.slideIndex}
              slideIndex={slide.slideIndex}
              slide={slide.slide}
              label={slide.label}
              answeredCount={slide.answeredCount}
              distribution={slide.distribution}
              participants={headcount}
            />
          ))
        )}
        {results.leaderboard ? <LeaderboardPanel rows={results.leaderboard} /> : null}
    </>
  );
}
