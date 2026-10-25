"use client";

import Link from "next/link";
import { ArrowLeft, FileBarChart, Link2, Play, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSessionList } from "../hooks/useSessionList";
import { formatDateTime, reportPath } from "../query";
import { MessageCard, PageHeader, Skeleton, StatusBadge } from "./ui";

/** `/presentations/[id]/sessions`: every run of a deck, newest first. */
export function SessionsList({ presentationId }: { presentationId: string }) {
  const t = useTranslations("sessions.list");
  const list = useSessionList(presentationId);

  return (
    <>
      <PageHeader>
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/polls?type=presentation"
            aria-label={t("backToLibrary")}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-foreground/90">{list.title ?? t("title")}</h1>
            <p className="text-[11px] text-muted-foreground">
              {t("title")}
              {!list.loading && !list.error ? ` · ${t("count", { count: list.items.length })}` : ""}
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="rounded-xl font-bold">
          <Link href={`/presentation/host/${presentationId}`}>
            <Play /> {list.items.length > 0 ? t("presentAgain") : t("present")}
          </Link>
        </Button>
      </PageHeader>

      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-6">
        {list.loading ? (
          <div role="status" aria-label={t("loading")} className="space-y-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-16" />
            ))}
          </div>
        ) : list.error ? (
          <MessageCard
            tone="error"
            title={list.error === "notFound" ? t("notFound") : t("loadFailed")}
          >
            {list.error === "failed" ? (
              <Button variant="outline" size="sm" className="rounded-xl" onClick={list.reload}>
                <RefreshCw /> {t("retry")}
              </Button>
            ) : null}
          </MessageCard>
        ) : list.items.length === 0 ? (
          <MessageCard title={t("emptyTitle")} hint={t("emptyHint")} />
        ) : (
          <>
            <div className="hidden grid-cols-[1.2fr_1.2fr_0.8fr_0.8fr_auto] gap-4 px-5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 md:grid">
              <span>{t("colSession")}</span>
              <span>{t("colStarted")}</span>
              <span>{t("colParticipants")}</span>
              <span>{t("colResponses")}</span>
              <span className="w-28" />
            </div>
            <ul className="space-y-2.5">
              {list.items.map((item) => (
                <li key={item.sessionId}>
                  <Link
                    href={reportPath(presentationId, item.sessionId)}
                    className={cn(
                      "grid items-center gap-x-4 gap-y-2 rounded-[1.5rem] border border-border bg-card px-5 py-4 transition-all",
                      "grid-cols-2 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
                      "md:grid-cols-[1.2fr_1.2fr_0.8fr_0.8fr_auto]"
                    )}
                  >
                    <span className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
                      <span className="text-sm font-bold text-foreground/90">{t("run", { number: item.runNumber })}</span>
                      <StatusBadge status={item.status} />
                      {item.shared ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          <Link2 className="size-3" /> {t("shared")}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className="md:hidden">{t("colStarted")}: </span>
                      {formatDateTime(item.startedAt)}
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-foreground/80">
                      <span className="font-normal text-muted-foreground md:hidden">{t("colParticipants")}: </span>
                      {item.participantCount}
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-foreground/80">
                      <span className="font-normal text-muted-foreground md:hidden">{t("colResponses")}: </span>
                      {item.answerCount}
                    </span>
                    <span className="col-span-2 inline-flex items-center justify-end gap-1.5 text-xs font-bold text-primary md:col-span-1 md:w-28">
                      <FileBarChart className="size-3.5" /> {t("openReport")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {list.hasMore ? (
              <div className="flex justify-center pt-2">
                <Button variant="outline" className="rounded-xl" disabled={list.loadingMore} onClick={list.loadMore}>
                  {list.loadingMore ? t("loading") : t("loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
