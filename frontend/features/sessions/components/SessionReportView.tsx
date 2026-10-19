"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link2, RefreshCw, Trash2 } from "lucide-react";
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
import { MessageCard, PageHeader, Skeleton, StatTile, StatusBadge } from "./ui";

/** `/presentations/[id]/sessions/[sessionId]`: the report of one run. */
export function SessionReportView({ presentationId, sessionId }: { presentationId: string; sessionId: string }) {
  const t = useTranslations("sessions.report");
  const router = useRouter();
  const { report, loading, error, reload, setReport } = useSessionReport(sessionId);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const backHref = sessionsPath(report?.session.presentationId ?? presentationId);

  const header = (
    <PageHeader>
      <div className="flex min-w-0 items-center gap-3">
        <Link
          href={backHref}
          aria-label={t("back")}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        {report ? (
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground/90">{report.session.title}</h1>
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {t("run", { number: report.session.runNumber })}
              <StatusBadge status={report.session.status} />
            </p>
          </div>
        ) : (
          <h1 className="text-sm font-semibold text-foreground/90">{t("back")}</h1>
        )}
      </div>
      {report ? (
        <div className="flex flex-wrap items-center gap-2">
          <ExportMenu report={report} />
          {report.access.share ? (
            <Button variant="outline" size="sm" className="rounded-xl font-bold" onClick={() => setShareOpen(true)}>
              <Link2 /> {report.share?.active ? t("share.buttonShared") : t("share.button")}
            </Button>
          ) : null}
          {report.access.delete && !report.session.isLive ? (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl font-bold text-red-500 hover:bg-red-500/10 hover:text-red-500"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 /> {t("delete.button")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </PageHeader>
  );

  if (loading) {
    return (
      <>
        {header}
        <div role="status" aria-label={t("loading")} className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </>
    );
  }

  if (error || !report) {
    return (
      <>
        {header}
        <div className="px-4 py-10">
          <MessageCard tone="error" title={error === "notFound" ? t("notFound") : t("loadFailed")}>
            {error === "failed" ? (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={reload}>
                <RefreshCw /> {t("retry")}
              </Button>
            ) : null}
          </MessageCard>
        </div>
      </>
    );
  }

  return (
    <>
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
    </>
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
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-6">
      {session.isLive ? (
        <p role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          {t("liveBanner")}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label={t("stats.participants")} value={session.participantCount.toLocaleString()} />
        <StatTile label={t("stats.responses")} value={session.answerCount.toLocaleString()} />
        <StatTile
          label={t("stats.participation")}
          value={formatPercent(session.participationRate)}
          hint={t("participationHint")}
        />
        <StatTile label={t("stats.duration")} value={formatDuration(session.durationMs)} />
        <StatTile label={t("stats.started")} value={<span className="text-sm">{formatDateTime(session.startedAt)}</span>} />
      </dl>

      <section aria-labelledby="slides-title" className="space-y-4">
        <h2 id="slides-title" className="text-base font-bold tracking-tight">
          {t("slides.title")}
        </h2>
        {charted.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{t("slides.empty")}</p>
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
          <p className="text-xs text-muted-foreground">
            {t("slides.notShownList", { slides: skipped.map((slide) => `${slide.slideIndex + 1}. ${slide.label}`).join("; ") })}
          </p>
        ) : null}
      </section>

      <LeaderboardPanel rows={standings} />
      <ParticipantsTable participants={report.participants} responseSlides={session.responseSlideCount} />
    </div>
  );
}
