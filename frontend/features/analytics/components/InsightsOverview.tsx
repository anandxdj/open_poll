"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, Presentation, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  countChange,
  formatDay,
  formatPercent,
  RANGES,
  rateChange,
  timeAgo,
  type Change,
  type Insights,
  type InsightsDay,
  type RangeDays,
} from "../insights";

// The overview of /analytics: headline numbers against the previous period,
// activity per day, the most attended content and the latest sessions.
// Graph paper rules: hairline strips, 12px sheets, ink text, one chart hue.

const tick = { fill: "var(--muted-foreground)", fontSize: 12 };

/** A segmented control of pressed buttons (the same shape as the chart picker). */
function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-secondary p-[3px]">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 rounded-full px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
              active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function RangeSwitch({ value, onChange }: { value: RangeDays; onChange: (days: RangeDays) => void }) {
  return (
    <Segmented
      label="Date range"
      value={value}
      onChange={onChange}
      options={RANGES.map((days) => ({ value: days, label: `${days} days` }))}
    />
  );
}

/** The change line under a headline number: a coloured arrow, the amount in ink, then what it compares with. */
function ChangeLine({ change, days }: { change: Change; days: number }) {
  if (change.amount === null) {
    return <p className="mt-2 text-sm text-muted-foreground">Nothing to compare yet</p>;
  }
  const Icon = change.trend === "up" ? ArrowUpRight : change.trend === "down" ? ArrowDownRight : Minus;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      <Icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          change.trend === "up" ? "text-success" : change.trend === "down" ? "text-destructive" : "text-faint",
        )}
      />
      <span className="font-mono tabular-nums text-foreground">{change.amount}</span>
      <span>vs previous {days} days</span>
    </p>
  );
}

export function HeadlineNumbers({ data }: { data: Insights | null }) {
  const days = data?.range.days ?? 30;
  const items = data
    ? [
        { label: "Sessions", value: data.totals.sessions.toLocaleString(), change: countChange(data.totals.sessions, data.previous.sessions) },
        { label: "Participants", value: data.totals.participants.toLocaleString(), change: countChange(data.totals.participants, data.previous.participants) },
        {
          label: "Responses",
          hint: "Answers in live sessions plus poll responses",
          value: data.totals.responses.toLocaleString(),
          change: countChange(data.totals.responses, data.previous.responses),
        },
        {
          label: "Engagement",
          hint: "Answers out of everything participants could answer, in ended sessions",
          value: formatPercent(data.totals.engagement),
          change: rateChange(data.totals.engagement, data.previous.engagement),
        },
      ]
    : null;

  return (
    <dl className="grid grid-cols-2 border-y border-border lg:grid-cols-4">
      {(items ?? Array.from({ length: 4 }, () => null)).map((item, i) => (
        <div
          key={item?.label ?? i}
          title={item?.hint}
          className={cn(
            "min-w-0 py-4 sm:py-5",
            i % 2 === 1 ? "border-l border-border pl-4 sm:pl-6" : "pr-4",
            i >= 2 && "border-t border-border lg:border-t-0",
            i === 2 && "lg:border-l lg:pl-6",
          )}
        >
          {item ? (
            <>
              <dt className="text-sm text-muted-foreground">{item.label}</dt>
              <dd className="mt-1.5 text-3xl font-semibold leading-none tabular-nums tracking-[-0.03em] sm:text-4xl">
                {item.value}
              </dd>
              <dd>
                <ChangeLine change={item.change} days={days} />
              </dd>
            </>
          ) : (
            <div aria-hidden className="space-y-3">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-9 w-16 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            </div>
          )}
        </div>
      ))}
    </dl>
  );
}

type Metric = "participants" | "responses" | "sessions";
const METRICS: { value: Metric; label: string }[] = [
  { value: "participants", label: "Participants" },
  { value: "responses", label: "Responses" },
  { value: "sessions", label: "Sessions" },
];

/** The hovered day: the chosen number first and strong, then the other two. */
function DayTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: InsightsDay }[]; metric: Metric }) {
  if (!active || !payload?.length) return null;
  const day = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg shadow-black/10">
      <p className="text-xs text-muted-foreground">{formatDay(day.date, true)}</p>
      <dl className="mt-1 space-y-0.5 text-sm">
        {METRICS.map((m) => (
          <div key={m.value} className="flex items-baseline justify-between gap-6">
            <dt className={m.value === metric ? "text-foreground" : "text-muted-foreground"}>{m.label}</dt>
            <dd className={cn("font-mono tabular-nums", m.value === metric ? "font-medium text-foreground" : "text-muted-foreground")}>
              {day[m.value].toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ActivityChart({ data }: { data: Insights | null }) {
  const [metric, setMetric] = useState<Metric>("participants");
  const daily = useMemo(() => data?.daily ?? [], [data]);
  const total = daily.reduce((sum, day) => sum + day[metric], 0);
  const empty = data !== null && daily.every((day) => day.sessions === 0 && day.responses === 0);
  // Every date for a week, about eight labels for longer ranges.
  const interval = Math.max(0, Math.ceil(daily.length / 8) - 1);

  return (
    <section aria-labelledby="activity-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="activity-title" className="text-xl font-semibold tracking-[-0.02em]">
            Activity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? (
              <>
                <span className="font-mono tabular-nums text-foreground">{total.toLocaleString()}</span>{" "}
                {METRICS.find((m) => m.value === metric)!.label.toLowerCase()} in the last {data.range.days} days, per day in
                your time zone.
              </>
            ) : (
              "Per day, in your time zone."
            )}
          </p>
        </div>
        <Segmented label="Activity shown" value={metric} onChange={setMetric} options={METRICS} />
      </div>

      <div className="relative mt-5 h-72 rounded-xl border border-border bg-card px-3 pb-2 pt-5 sm:px-5">
        {data ? (
          <>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={daily} margin={{ top: 4, right: 16, left: -12, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  tick={tick}
                  interval={interval}
                  tickFormatter={(value: string) => formatDay(value)}
                  minTickGap={8}
                />
                <YAxis width={40} tickLine={false} axisLine={false} tick={tick} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--accent)" }} content={<DayTooltip metric={metric} />} />
                <Bar dataKey={metric} fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} />
              </BarChart>
            </ResponsiveContainer>
            {empty ? (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                No sessions or poll responses in the last {data.range.days} days.
              </p>
            ) : null}
          </>
        ) : (
          <div aria-hidden className="flex h-full items-end gap-1.5 pb-6">
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="flex-1 animate-pulse rounded-t bg-muted" style={{ height: `${25 + ((i * 37) % 60)}%` }} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const sessionsHref = (presentationId: string) => `/presentations/${presentationId}/sessions`;

export function TopContent({ data }: { data: Insights | null }) {
  const max = Math.max(1, ...(data?.top ?? []).map((item) => item.people));
  return (
    <section aria-labelledby="top-title" className="min-w-0">
      <h2 id="top-title" className="text-xl font-semibold tracking-[-0.02em]">
        Top decks and polls
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Decks by participants, polls by responses.</p>
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
        {!data ? (
          <ListSkeleton />
        ) : data.top.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Nothing was presented or answered in this range yet.</p>
        ) : (
          <ol className="divide-y divide-border">
            {data.top.map((item, i) => {
              const Icon = item.type === "presentation" ? Presentation : BarChart3;
              const href = item.type === "presentation" ? sessionsHref(item.id) : `/analytics/${item.id}`;
              return (
                <li key={`${item.type}:${item.id}`}>
                  <Link
                    href={href}
                    className="group grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-5 py-3.5 transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className={cn("font-mono text-sm tabular-nums", i === 0 ? "text-accent-ink" : "text-muted-foreground")}>
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
                          {item.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {item.type === "presentation"
                            ? `Deck, ${item.runs} session${item.runs === 1 ? "" : "s"}`
                            : "Poll"}
                        </span>
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-sm tabular-nums text-foreground">{item.people.toLocaleString()}</span>
                      <span className="block text-xs text-muted-foreground">
                        {item.type === "presentation" ? "participants" : "responses"}
                      </span>
                    </span>
                    {/* Share of the top item: one hue, one series. */}
                    <span aria-hidden className="col-start-2 col-end-4 h-1 overflow-hidden rounded-full bg-secondary">
                      <span className="block h-full rounded-full bg-chart-1" style={{ width: `${(item.people / max) * 100}%` }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

export function RecentSessions({ data }: { data: Insights | null }) {
  return (
    <section aria-labelledby="recent-title" className="min-w-0">
      <h2 id="recent-title" className="text-xl font-semibold tracking-[-0.02em]">
        Recent sessions
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">The latest live runs. Open one for its report.</p>
      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
        {!data ? (
          <ListSkeleton />
        ) : data.recentSessions.length === 0 ? (
          <div className="px-5 py-8">
            <p className="text-sm text-muted-foreground">No live sessions in this range.</p>
            <Button asChild variant="outline" size="sm" className="mt-3 bg-card">
              <Link href="/polls?type=presentation">Present a deck</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {data.recentSessions.map((s) => (
              <li key={s.sessionId}>
                <Link
                  href={`${sessionsHref(s.presentationId)}/${s.sessionId}`}
                  className="group flex items-center gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
                        {s.title}
                      </span>
                      {s.isLive ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          <span aria-hidden className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
                          Live
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Session {s.runNumber}, {timeAgo(s.startedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-sm tabular-nums text-foreground">{s.participantCount.toLocaleString()}</span>
                    <span className="block text-xs text-muted-foreground">joined</span>
                  </span>
                  <span className="hidden w-16 shrink-0 text-right sm:block">
                    <span className="block font-mono text-sm tabular-nums text-foreground">{formatPercent(s.participationRate)}</span>
                    <span className="block text-xs text-muted-foreground">answered</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden className="divide-y divide-border">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-10 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function InsightsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-sm text-foreground">Couldn&apos;t load the activity for this range.</p>
      <Button variant="outline" size="sm" className="bg-card" onClick={onRetry}>
        <RefreshCw /> Try again
      </Button>
    </div>
  );
}

/** "1 session and 2 polls live now", or nothing. */
export function LiveNow({ data }: { data: Insights | null }) {
  if (!data) return null;
  const { sessions, polls } = data.liveNow;
  if (sessions + polls === 0) return null;
  const parts = [
    sessions ? `${sessions} session${sessions === 1 ? "" : "s"}` : null,
    polls ? `${polls} poll${polls === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return (
    <p className="mt-3 flex items-center gap-2 text-sm text-foreground">
      <span aria-hidden className="size-2 rounded-full bg-success motion-safe:animate-pulse" />
      {parts.join(" and ")} live now
    </p>
  );
}
