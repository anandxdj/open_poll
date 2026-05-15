"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, BarChart2, TrendingUp, Users, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type PollSummary = {
  id: string;
  title: string;
  totalResponses: number;
  isActive: boolean;
};

type Props = {
  summaries: PollSummary[];
  isLoading: boolean;
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
} as const;
const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: "easeOut" as const } },
} as const;

export function AnalyticsOverview({ summaries, isLoading }: Props) {
  const totalVotes = useMemo(() => summaries.reduce((a, s) => a + s.totalResponses, 0), [summaries]);
  const activeCount = useMemo(() => summaries.filter((s) => s.isActive).length, [summaries]);
  const top5 = useMemo(
    () => [...summaries].sort((a, b) => b.totalResponses - a.totalResponses).slice(0, 5),
    [summaries]
  );
  const maxVotes = top5[0]?.totalResponses ?? 1;

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-foreground/5" />
        ))}
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-[2rem] border border-foreground/10 bg-card p-16 text-center shadow-sm">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground/5 ring-1 ring-foreground/10">
          <BarChart2 className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground/70">No data yet</h3>
          <p className="text-sm text-muted-foreground">Create and publish polls to see analytics here.</p>
        </div>
        <Link
          href="/create"
          className="mt-2 inline-flex items-center gap-2 rounded-2xl border border-yellow-500/30 bg-yellow-400 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-300 transition-colors"
        >
          <Zap className="size-4" />
          Create a poll
        </Link>
      </div>
    );
  }

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-8">
      {/* Aggregate stat row */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Total Votes", value: totalVotes, icon: TrendingUp, accent: "text-orange-400" },
          { label: "Active Polls", value: activeCount, icon: Zap, accent: "text-emerald-400", sub: activeCount > 0 ? "Live now" : "None running" },
          { label: "Polls Tracked", value: summaries.length, icon: BarChart2, accent: "text-violet-400" },
        ].map((stat) => (
          <motion.div key={stat.label} variants={item}>
            <div className="group relative p-px rounded-[1.75rem] bg-gradient-to-b from-foreground/10 to-transparent transition-all hover:from-foreground/20">
              <div className="rounded-[calc(1.75rem-1px)] bg-card p-6 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                    <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">{stat.value}</p>
                    {stat.sub && <p className="text-xs text-muted-foreground/70">{stat.sub}</p>}
                  </div>
                  <div className={cn("flex size-10 items-center justify-center rounded-2xl bg-foreground/5 ring-1 ring-foreground/10", stat.accent)}>
                    <stat.icon className="size-5" strokeWidth={1.5} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Live now banner */}
      {activeCount > 0 && (
        <motion.div variants={item} className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
          <span className="flex size-2 shrink-0 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-sm text-emerald-400 font-medium">
            {activeCount} poll{activeCount > 1 ? "s" : ""} collecting responses right now
          </p>
        </motion.div>
      )}

      {/* Top polls leaderboard */}
      <motion.div variants={item} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Top Polls by Votes</h2>
          <Users className="size-4 text-muted-foreground/40" />
        </div>

        <div className="space-y-2">
          {top5.map((poll, i) => {
            const pct = maxVotes > 0 ? (poll.totalResponses / maxVotes) * 100 : 0;
            return (
              <Link
                key={poll.id}
                href={`/analytics/${poll.id}`}
                className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card px-4 py-3 transition-all hover:border-primary/30 hover:bg-secondary/10"
              >
                {/* Progress bar bg */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-yellow-400/[0.06] to-transparent transition-all duration-700"
                  style={{ width: `${pct}%` }}
                />

                <span className={cn(
                  "relative flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums",
                  i === 0 ? "bg-yellow-400 text-black" : "bg-secondary text-muted-foreground/70"
                )}>
                  {i + 1}
                </span>

                <div className="relative min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {poll.title}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {poll.isActive && (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Live
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground/60">{poll.totalResponses} response{poll.totalResponses !== 1 ? "s" : ""}</span>
                  </div>
                </div>

                <ArrowRight className="relative size-4 shrink-0 text-muted-foreground/30 transition-all group-hover:translate-x-1 group-hover:text-primary/70" />
              </Link>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
