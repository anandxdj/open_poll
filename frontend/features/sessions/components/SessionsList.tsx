"use client";

import Link from "next/link";
import { ChevronRight, Link2, Play, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useSessionList } from "../hooks/useSessionList";
import { formatDateTime, reportPath } from "../query";
import { BackLink, MessageCard, page, Skeleton, StatusBadge } from "./ui";

const columns = "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_7rem_7rem_7.5rem]";

/** `/presentations/[id]/sessions`: every run of a deck, newest first. */
export function SessionsList({ presentationId }: { presentationId: string }) {
  const t = useTranslations("sessions.list");
  const list = useSessionList(presentationId);
  const ready = !list.loading && !list.error;

  return (
    <div className={page}>
      <BackLink href="/polls?type=presentation">{t("backToLibrary")}</BackLink>

      <header className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">
            {list.title ?? t("title")}
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            {t("title")}
            {ready ? (
              <span className="ml-2 font-mono text-sm tabular-nums">{list.items.length}</span>
            ) : null}
          </p>
        </div>
        <Button asChild className="sm:shrink-0">
          <Link href={`/presentation/host/${presentationId}`}>
            <Play /> {list.items.length > 0 ? t("presentAgain") : t("present")}
          </Link>
        </Button>
      </header>

      <div className="mt-8">
        {list.loading ? (
          <div role="status" aria-label={t("loading")} className="space-y-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16" />
            ))}
          </div>
        ) : list.error ? (
          <MessageCard tone="error" title={list.error === "notFound" ? t("notFound") : t("loadFailed")}>
            {list.error === "failed" ? (
              <Button variant="outline" size="sm" className="bg-card" onClick={list.reload}>
                <RefreshCw /> {t("retry")}
              </Button>
            ) : null}
          </MessageCard>
        ) : list.items.length === 0 ? (
          <MessageCard title={t("emptyTitle")} hint={t("emptyHint")} />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div
                className={`hidden gap-4 border-b border-border px-5 py-3 text-sm text-muted-foreground md:grid ${columns}`}
              >
                <span>{t("colSession")}</span>
                <span>{t("colStarted")}</span>
                <span className="text-right">{t("colParticipants")}</span>
                <span className="text-right">{t("colResponses")}</span>
                <span />
              </div>
              <ul className="divide-y divide-border">
                {list.items.map((item) => (
                  <li key={item.sessionId}>
                    <Link
                      href={reportPath(presentationId, item.sessionId)}
                      className={`group grid grid-cols-2 items-center gap-x-4 gap-y-1.5 px-5 py-4 transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${columns}`}
                    >
                      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 md:col-span-1">
                        <span className="text-base font-medium text-foreground">{t("run", { number: item.runNumber })}</span>
                        <StatusBadge status={item.status} />
                        {item.shared ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
                            <Link2 className="size-3" aria-hidden /> {t("shared")}
                          </span>
                        ) : null}
                      </span>
                      <span className="col-span-2 text-sm text-muted-foreground md:col-span-1">
                        <span className="md:hidden">{t("colStarted")}: </span>
                        {formatDateTime(item.startedAt)}
                      </span>
                      <span className="text-sm text-muted-foreground md:text-right">
                        <span className="md:hidden">{t("colParticipants")}: </span>
                        <span className="font-mono tabular-nums text-foreground">{item.participantCount}</span>
                      </span>
                      <span className="text-sm text-muted-foreground md:text-right">
                        <span className="md:hidden">{t("colResponses")}: </span>
                        <span className="font-mono tabular-nums text-foreground">{item.answerCount}</span>
                      </span>
                      <span className="col-span-2 inline-flex items-center gap-1 text-sm font-medium text-foreground md:col-span-1 md:justify-end">
                        {t("openReport")}
                        <ChevronRight
                          className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {list.hasMore ? (
              <div className="flex justify-center pt-4">
                <Button variant="outline" className="bg-card" disabled={list.loadingMore} onClick={list.loadMore}>
                  {list.loadingMore ? t("loading") : t("loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
