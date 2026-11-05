"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSessionReport } from "../hooks/useSessionReport";
import type { SessionReport } from "../types";
import {
  chartedSlides,
  formatDateTime,
  formatDuration,
  formatPercent,
  sessionsPath,
  skippedSlides,
  stageParticipants,
} from "../query";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import { ExportMenu } from "./ExportMenu";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { ParticipantsTable } from "./ParticipantsTable";
import { ShareDialog } from "./ShareDialog";
import { SlideResultCard } from "./SlideResultCard";
import { BackLink, LiveNotice, MessageCard, page, SectionTitle, Skeleton, StatStrip, StatusBadge } from "./ui";

/** `/presentations/[id]/sessions/[sessionId]`: the report of one run. */
export function SessionReportView({ presentationId, sessionId }: { presentationId: string; sessionId: string }) {
  const t = useTranslations("sessions.report");
  const router = useRouter();
  const { report, loading, error, reload, setReport } = useSessionReport(sessionId);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const backHref = sessionsPath(report?.session.presentationId ?? presentationId);

  const header = (
    <>
      <BackLink href={backHref}>{t("back")}</BackLink>
      <header className="mt-4 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        {report ? (
          <div className="min-w-0">
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
              {report.session.title}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t("run", { number: report.session.runNumber })}</span>
              <StatusBadge status={report.session.status} />
              <span>{t("startedAt", { date: formatDateTime(report.session.startedAt) })}</span>
            </p>
          </div>
        ) : (
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">{t("title")}</h1>
        )}
        {report ? (
          <div className="flex flex-wrap items-center gap-2 md:shrink-0">
            {report.access.delete && !report.session.isLive ? (
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 /> {t("delete.button")}
              </Button>
            ) : null}
            <ExportMenu report={report} />
            {report.access.share ? (
              <Button variant="outline" className="bg-card" onClick={() => setShareOpen(true)}>
                <Link2 /> {report.share?.active ? t("share.buttonShared") : t("share.button")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>
    </>
  );

  if (loading) {
    return (
      <div className={page}>
        {header}
        <div role="status" aria-label={t("loading")} className="mt-8 space-y-6">
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className={page}>
        {header}
        <div className="mt-10">
          <MessageCard tone="error" title={error === "notFound" ? t("notFound") : t("loadFailed")}>
            {error === "failed" ? (
              <Button variant="outline" size="sm" className="bg-card" onClick={reload}>
                <RefreshCw /> {t("retry")}
              </Button>
            ) : null}
          </MessageCard>
        </div>
      </div>
    );
  }

  return (
    <div className={page}>
      {header}
      <ReportContent report={report} />

      {shareOpen ? (
        <ShareDialog
          open
          onOpenChange={setShareOpen}
          sessionId={report.session.sessionId}
          ended={!report.session.isLive && report.session.status === "ended"}
          share={report.share}
          onChange={(share) => setReport({ ...report, share })}
        />
      ) : null}
      <DeleteSessionDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        sessionId={report.session.sessionId}
        runNumber={report.session.runNumber}
        onDeleted={() => router.replace(sessionsPath(report.session.presentationId))}
      />
    </div>
  );
}

/** The report body: live banner, key numbers, per-slide results, standings and participants. */
export function ReportContent({ report }: { report: SessionReport }) {
  const t = useTranslations("sessions.report");
  const { session } = report;
  const charted = chartedSlides(report.slides);
  const skipped = skippedSlides(report.slides);
  const participants = useMemo(() => stageParticipants(report.participants), [report.participants]);
  const standings = useMemo(
    () => report.leaderboard.map(({ rank, name, score, correctCount }) => ({ rank, name, score, correctCount })),
    [report.leaderboard]
  );

  return (
    <div className="mt-8 space-y-10">
      {session.isLive ? <LiveNotice>{t("liveBanner")}</LiveNotice> : null}

      <StatStrip
        stats={[
          { label: t("stats.participants"), value: session.participantCount.toLocaleString() },
          { label: t("stats.responses"), value: session.answerCount.toLocaleString() },
          {
            label: t("stats.participation"),
            value: formatPercent(session.participationRate),
            hint: t("participationHint"),
          },
          { label: t("stats.duration"), value: formatDuration(session.durationMs) },
        ]}
      />

      <section aria-labelledby="slides-title" className="space-y-4">
        <SectionTitle id="slides-title">{t("slides.title")}</SectionTitle>
        {charted.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{t("slides.empty")}</p>
        ) : (
          charted.map((slide) => (
            <SlideResultCard
              key={slide.slideId}
              slideIndex={slide.slideIndex}
              slide={slide.slide}
              typeName={slide.typeName}
              label={slide.label}
              answeredCount={slide.answeredCount}
              distribution={slide.distribution}
              participants={participants}
            />
          ))
        )}
        {skipped.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("slides.notShownList", { slides: skipped.map((slide) => `${slide.slideIndex + 1}. ${slide.label}`).join("; ") })}
          </p>
        ) : null}
      </section>

      <LeaderboardPanel rows={standings} />
      <ParticipantsTable participants={report.participants} responseSlides={session.responseSlideCount} />
    </div>
  );
}
