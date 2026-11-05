"use client";

import { useMemo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PublicPageShell } from "@/features/landing/components/shared/PublicPageShell";
import type { LiveParticipant } from "@/features/presentations/types/live";
import { usePublicResults } from "../hooks/usePublicResults";
import type { PublicResults } from "../types";
import { formatDate, publicSlides } from "../query";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { SlideResultCard } from "./SlideResultCard";
import { MessageCard, Skeleton, StatStrip } from "./ui";

/** Charts only need the headcount: names are never sent unless the owner chose to. */
const MAX_PLACEHOLDERS = 10_000;

/** `/r/[token]`: the aggregated results of a shared session. No account, no private data. */
export function PublicResultsView({ token }: { token: string }) {
  const t = useTranslations("sessions.public");
  const { results, loading, error, reload } = usePublicResults(token);

  return (
    <PublicShell>
      {loading ? (
        <div role="status" aria-label={t("loading")} className="space-y-6">
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
            <Button variant="outline" size="sm" className="bg-card" onClick={reload}>
              <RefreshCw /> {t("retry")}
            </Button>
          ) : null}
        </MessageCard>
      ) : (
        <PublicResultsContent results={results} />
      )}
    </PublicShell>
  );
}

/** The shared-link page frame, named "Shared results". */
function PublicShell({ children }: { children: ReactNode }) {
  const t = useTranslations("sessions.public");
  return (
    <PublicPageShell label={t("kicker")} width="wide" footer={{ note: t("poweredBy"), cta: t("cta") }}>
      {children}
    </PublicPageShell>
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
    <div className="space-y-10">
      <header>
        <h1 className="text-balance text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">{results.title}</h1>
        <p className="mt-3 text-base text-muted-foreground">
          {t("run", { number: results.runNumber })}
        </p>
      </header>
      <StatStrip
        stats={[
          { label: t("stats.participants"), value: results.participantCount.toLocaleString() },
          { label: t("stats.responses"), value: results.answerCount.toLocaleString() },
          { label: t("stats.date"), value: <span className="text-xl sm:text-2xl">{formatDate(results.endedAt ?? results.startedAt)}</span> },
        ]}
      />

      {slides.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-4">
          {slides.map((slide) => (
            <SlideResultCard
              key={slide.slideIndex}
              slideIndex={slide.slideIndex}
              slide={slide.slide}
              label={slide.label}
              answeredCount={slide.answeredCount}
              distribution={slide.distribution}
              participants={headcount}
            />
          ))}
        </div>
      )}
      {results.leaderboard ? <LeaderboardPanel rows={results.leaderboard} /> : null}
    </div>
  );
}
