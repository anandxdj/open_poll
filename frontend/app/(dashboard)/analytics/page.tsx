"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart2, TrendingUp, Users, Vote } from "lucide-react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import { useCreatorStore, type Poll } from "@/features/polls/store/useCreatorStore";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ApiOk<T> = { success: boolean; data: T };
type SummaryData = { totalResponses?: number };

function isPollActive(poll: Poll) {
  if (!poll.isPublished || poll.isClosed) return false;
  return new Date(poll.expiresAt).getTime() > Date.now();
}

const ease = [0.32, 0.72, 0, 1] as const;

const PRIMARY = "#d8ad87";
const SECONDARY = "#b68d65";

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  sub,
  loading,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent?: string;
  sub?: string;
  loading?: boolean;
}) {
  return (
    <div className="group relative rounded-[1.5rem] border border-border bg-card p-5 transition-all duration-700 hover:border-primary/20">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          <p
            className={cn(
              "text-3xl font-bold tabular-nums tracking-tight",
              loading ? "text-muted-foreground/10" : "text-foreground/90"
            )}
          >
            {loading ? "—" : value}
          </p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl bg-secondary/30 ring-1 ring-border",
            accent ?? "text-primary"
          )}
        >
          <Icon className="size-5" strokeWidth={1.5} />
        </div>
      </div>
    </div>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-xl">
      <p className="text-muted-foreground mb-1 truncate max-w-[140px]">{label}</p>
      <p className="font-bold text-primary">{payload[0].value} responses</p>
    </div>
  );
}

export default function AnalyticsPage() {
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
        shortTitle: p.title.length > 20 ? p.title.slice(0, 18) + "…" : p.title,
        totalResponses: responseCounts[p._id] ?? 0,
        isActive: isPollActive(p),
        questions: p.questions.length,
      })),
    [polls, responseCounts]
  );

  const totalResponses = useMemo(
    () => Object.values(responseCounts).reduce((a, b) => a + b, 0),
    [responseCounts]
  );

  const activeCount = useMemo(() => polls.filter(isPollActive).length, [polls]);
  const isLoading = pollsLoading || countsLoading;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="space-y-3"
      >
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="-ml-2 h-8 gap-2 rounded-xl text-muted-foreground hover:bg-primary/10 hover:text-primary group/back"
        >
          <Link href="/polls">
            <ArrowLeft className="size-3.5 transition-transform group-hover/back:-translate-x-0.5" />
            Dashboard
          </Link>
        </Button>
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <BarChart2 className="size-3 text-primary" />
              Analytics
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground/90">Overview</h1>
            <p className="text-sm text-muted-foreground">
              Aggregate performance across all your polls.
            </p>
          </div>
        </div>
      </motion.div>

      {/* KPI cards */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease, delay: 0.1 }}
        className="grid gap-3 sm:grid-cols-3"
      >
        <StatCard
          label="Total Polls"
          value={isLoading ? "—" : polls.length}
          icon={Vote}
          loading={isLoading}
        />
        <StatCard
          label="Total Responses"
          value={isLoading ? "—" : totalResponses}
          icon={TrendingUp}
          accent="text-primary"
          loading={isLoading}
        />
        <StatCard
          label="Active Polls"
          value={isLoading ? "—" : activeCount}
          icon={Users}
          accent="text-emerald-500"
          sub={activeCount > 0 ? "Live now" : "None running"}
          loading={isLoading}
        />
      </motion.div>

      {/* Bar chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease, delay: 0.2 }}
        className="rounded-[1.75rem] border border-border bg-card p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Responses per Poll
            </p>
            <p className="text-lg font-semibold text-foreground/80">
              Response Distribution
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="text-sm text-muted-foreground animate-pulse">Loading chart…</div>
          </div>
        ) : summaries.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">No data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summaries} barSize={24}>
              <XAxis
                dataKey="shortTitle"
                tick={{ fill: "currentColor", fontSize: 10, opacity: 0.3 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "currentColor", fontSize: 10, opacity: 0.2 }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "currentColor", opacity: 0.03 }} />
              <Bar dataKey="totalResponses" radius={[6, 6, 0, 0]}>
                {summaries.map((_, i) => (
                  <Cell key={i} fill={i % 2 === 0 ? PRIMARY : SECONDARY} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </motion.div>

      {/* Poll performance table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease, delay: 0.3 }}
        className="rounded-[1.75rem] border border-border bg-card overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Poll Performance
          </p>
        </div>
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : summaries.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Create polls to see performance data here.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {summaries.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-6 py-4 hover:bg-secondary/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={cn(
                      "size-2 rounded-full shrink-0",
                      s.isActive ? "bg-emerald-500 animate-pulse" : "bg-muted"
                    )}
                  />
                  <p className="text-sm font-medium text-foreground/70 truncate">{s.title}</p>
                </div>
                <div className="flex items-center gap-6 shrink-0 ml-4">
                  <span className="text-xs text-muted-foreground">{s.questions}Q</span>
                  <span className="text-sm font-bold text-primary tabular-nums">
                    {s.totalResponses}
                  </span>
                  <Link
                    href={`/analytics/${s.id}`}
                    className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors uppercase tracking-widest"
                  >
                    Details →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
