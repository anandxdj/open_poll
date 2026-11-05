"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart2, Plus } from "lucide-react";

import { useCreatorStore, type Poll } from "@/features/polls/store/useCreatorStore";
import { useCreatePollModal } from "@/features/polls/components/CreatePollModalProvider";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ActivityChart,
  HeadlineNumbers,
  InsightsError,
  LiveNow,
  RangeSwitch,
  RecentSessions,
  TopContent,
} from "@/features/analytics/components/InsightsOverview";
import { useInsights } from "@/features/analytics/hooks/useInsights";
import type { RangeDays } from "@/features/analytics/insights";

type ApiOk<T> = { success: boolean; data: T };
type SummaryData = { totalResponses?: number };

function isPollActive(poll: Poll) {
  if (!poll.isPublished || poll.isClosed) return false;
  return new Date(poll.expiresAt).getTime() > Date.now();
}

/**
 * /analytics: workspace insights for a range (headline numbers against the
 * previous period, activity per day, top decks and polls, recent sessions),
 * then every poll's responses as a ranked bar list (one hue, most answered
 * first, the value at each bar's tip) where every row opens that poll.
 */
export default function AnalyticsPage() {
  const [days, setDays] = useState<RangeDays>(30);
  const insights = useInsights(days);
  const { polls, isLoading: pollsLoading, fetchPolls } = useCreatorStore();
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(false);

  useEffect(() => {
    void fetchPolls();
  }, [fetchPolls]);

  useEffect(() => {
    if (pollsLoading || polls.length === 0) return;
    let cancelled = false;

    void (async () => {
      setCountsLoading(true);
      const settled = await Promise.allSettled(
        polls.map(async (p) => {
          const res = await apiClient.get<ApiOk<SummaryData>>(`/responses/poll/${p._id}/summary`);
          return { id: p._id, total: res.data?.data?.totalResponses ?? 0 };
        })
      );
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const result of settled) {
        if (result.status === "fulfilled") map[result.value.id] = result.value.total;
      }
      setResponseCounts(map);
      setCountsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [polls, pollsLoading]);

  const summaries = useMemo(
    () =>
      polls.map((p) => ({
        id: p._id,
        title: p.title,
        totalResponses: responseCounts[p._id] ?? 0,
        isActive: isPollActive(p),
        questions: p.questions.length,
      })),
    [polls, responseCounts]
  );

  const isLoading = pollsLoading || countsLoading;
  const { open: openCreatePollModal } = useCreatePollModal();

  // Most answered first; ties keep the store's order.
  const ranked = useMemo(() => [...summaries].sort((a, b) => b.totalResponses - a.totalResponses), [summaries]);
  const max = Math.max(1, ...ranked.map((s) => s.totalResponses));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">Analytics</h1>
          <p className="mt-3 text-base text-muted-foreground">Live sessions and poll responses in this workspace.</p>
          <LiveNow data={insights.data} />
        </div>
        <div className="self-start sm:self-auto">
          <RangeSwitch value={days} onChange={setDays} />
        </div>
      </header>

      <div className="mt-8 space-y-12">
        {insights.status === "error" && !insights.data ? <InsightsError onRetry={insights.retry} /> : null}
        <div aria-busy={insights.status === "loading"} className={cn("space-y-12 transition-opacity duration-200", insights.status === "loading" && insights.data && "opacity-60")}>
          <HeadlineNumbers data={insights.data} />
          <ActivityChart data={insights.data} />
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-8">
            <TopContent data={insights.data} />
            <RecentSessions data={insights.data} />
          </div>
        </div>
      </div>

      <section aria-labelledby="per-poll-title" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="per-poll-title" className="text-xl font-semibold tracking-[-0.02em]">
              Responses per poll
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              All time, most answered first. Open a poll for its results and voters.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 divide-y divide-border rounded-xl border border-border bg-card">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
                <div className="h-2.5 flex-1 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        ) : ranked.length === 0 ? (
          <div className="relative mt-5 overflow-hidden rounded-2xl border border-border bg-card px-6 py-14 text-center">
            <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
            <div className="relative">
              <BarChart2 className="mx-auto size-8 text-accent-ink" aria-hidden="true" />
              <p className="mt-4 text-lg font-semibold tracking-[-0.02em]">No polls yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                Publish a poll and its responses show up here as they arrive.
              </p>
              <Button className="mt-5" onClick={() => openCreatePollModal()}>
                <Plus /> New poll
              </Button>
            </div>
          </div>
        ) : (
          <ol className="mt-5 divide-y divide-border rounded-xl border border-border bg-card">
            {ranked.map((s) => {
              const pct = (s.totalResponses / max) * 100;
              return (
                <li key={s.id}>
                  <Link
                    href={`/analytics/${s.id}`}
                    className="group grid grid-cols-1 gap-x-6 gap-y-2.5 px-5 py-4 transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-center"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className={cn("size-1.5 shrink-0 rounded-full", s.isActive ? "bg-success" : "bg-faint")}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
                          {s.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {s.isActive ? "Live" : "Not live"}, {s.questions} question{s.questions === 1 ? "" : "s"}
                        </span>
                      </span>
                    </span>
                    {/* Bar with its value at the tip; one hue for the one series. */}
                    <span className="flex items-center gap-3">
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <span
                          className="block h-full rounded-full bg-chart-1 transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                      <span className="w-10 shrink-0 text-right font-mono text-sm tabular-nums text-foreground">
                        {s.totalResponses}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
