"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VisualizationType } from "./VisualizationPicker";

type Row = { label: string; votes: number };

/**
 * One question's results. Marks follow the dataviz rules: one hue for the
 * single series (ember; correct answers of an assessment in the success
 * colour, also marked with a check and the word), bars at most 24px with a
 * 4px rounded end, hairline solid grid, values in text tokens at the bar tip.
 * The donut uses the categorical chart tokens in fixed order and folds
 * anything past the sixth option into "Other".
 */

const SERIES = "var(--chart-1)";
const CORRECT = "var(--success)";
const CATEGORICAL = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];
const OTHER = "var(--faint)";
const tick = { fill: "var(--muted-foreground)", fontSize: 12 };

interface QuestionAnalyticsProps {
  title: string;
  data: Row[];
  type: VisualizationType;
  correctOptionIndices?: number[];
  explanation?: string;
}

/** Value first and strong, label second (the reader already knows which mark they hover). */
function ChartTooltip({ active, payload, total }: { active?: boolean; payload?: { value: number; payload: Row }[]; total: number }) {
  if (!active || !payload?.length) return null;
  const { value, payload: row } = payload[0];
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg shadow-black/10">
      <p className="font-mono text-sm font-medium tabular-nums text-foreground">
        {value} <span className="text-muted-foreground">({pct}%)</span>
      </p>
      <p className="mt-0.5 max-w-48 text-xs text-muted-foreground">{row.label}</p>
    </div>
  );
}

const truncate = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

export function QuestionAnalytics({ title, data, type, correctOptionIndices, explanation }: QuestionAnalyticsProps) {
  const totalVotes = useMemo(() => data.reduce((sum, d) => sum + d.votes, 0), [data]);
  const isCorrect = (i: number) => correctOptionIndices?.includes(i) ?? false;
  const markFill = (i: number) => (isCorrect(i) ? CORRECT : SERIES);

  // Donut slices: six categorical slots in fixed order, the rest folded into "Other".
  const slices = useMemo(() => {
    if (data.length <= 6) return data.map((row, i) => ({ ...row, fill: CATEGORICAL[i] }));
    const head = data.slice(0, 5).map((row, i) => ({ ...row, fill: CATEGORICAL[i] }));
    const rest = data.slice(5).reduce((sum, row) => sum + row.votes, 0);
    return [...head, { label: `Other (${data.length - 5})`, votes: rest, fill: OTHER }];
  }, [data]);

  const tooltip = <Tooltip cursor={{ fill: "var(--accent)" }} content={<ChartTooltip total={totalVotes} />} />;

  const content = () => {
    switch (type) {
      case "bar-v":
        return (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={data} margin={{ top: 24, right: 4, left: -12, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={tick}
                interval={0}
                height={40}
                tickFormatter={(v: string) => truncate(v, 18)}
              />
              <YAxis width={40} tickLine={false} axisLine={false} tick={tick} allowDecimals={false} />
              {tooltip}
              <Bar dataKey="votes" radius={[4, 4, 0, 0]} maxBarSize={24} animationDuration={500}>
                {data.map((_, i) => (
                  <Cell key={i} fill={markFill(i)} />
                ))}
                <LabelList dataKey="votes" position="top" offset={8} fill="var(--muted-foreground)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case "bar-h":
        return (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                dataKey="label"
                type="category"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={tick}
                width={128}
                tickFormatter={(v: string) => truncate(v, 18)}
              />
              {tooltip}
              <Bar dataKey="votes" radius={[0, 4, 4, 0]} maxBarSize={24} animationDuration={500}>
                {data.map((_, i) => (
                  <Cell key={i} fill={markFill(i)} />
                ))}
                <LabelList dataKey="votes" position="right" offset={8} fill="var(--muted-foreground)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <div className="grid h-full items-center gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="h-56 sm:h-full">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart>
                  {/* The 2px surface-coloured stroke is the gap between slices. */}
                  <Pie
                    data={slices}
                    dataKey="votes"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="88%"
                    stroke="var(--card)"
                    strokeWidth={2}
                    animationDuration={600}
                  >
                    {slices.map((slice) => (
                      <Cell key={slice.label} fill={slice.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip total={totalVotes} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend: identity never by colour alone. */}
            <ul className="space-y-2.5">
              {slices.map((slice, i) => (
                <li key={slice.label} className="flex items-center gap-2.5 text-sm">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: slice.fill }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{slice.label}</span>
                  {isCorrect(i) && data.length <= 6 ? <Check className="size-4 shrink-0 text-success" aria-label="Correct answer" /> : null}
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{slice.votes}</span>
                </li>
              ))}
            </ul>
          </div>
        );

      case "list":
        return (
          <ul className="space-y-4 py-1">
            {data.map((item, i) => {
              const pct = totalVotes > 0 ? (item.votes / totalVotes) * 100 : 0;
              return (
                <li key={`${item.label}-${i}`}>
                  <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 text-foreground">
                      <span className="truncate">{item.label}</span>
                      {isCorrect(i) ? (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                          <Check className="size-3.5" aria-hidden="true" /> Correct
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {item.votes} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
                      className={cn("h-full rounded-full", isCorrect(i) ? "bg-success" : "bg-chart-1")}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        );
    }
  };

  // Charts get a fixed height; the list grows with its options.
  const chartHeight = type === "list" ? undefined : type === "bar-h" ? Math.max(160, data.length * 44) : 256;

  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <header className="mb-5 flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold leading-snug tracking-[-0.015em] text-foreground">{title}</h3>
        <p className="shrink-0 text-sm text-muted-foreground">
          <span className="font-mono tabular-nums text-foreground">{totalVotes}</span> answer{totalVotes === 1 ? "" : "s"}
        </p>
      </header>

      <div className="w-full min-w-0" style={chartHeight ? { height: chartHeight } : undefined}>
        {totalVotes === 0 && type !== "list" ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
            No answers yet
          </div>
        ) : (
          content()
        )}
      </div>

      {(correctOptionIndices && correctOptionIndices.length > 0) || explanation ? (
        <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
          {correctOptionIndices && correctOptionIndices.length > 0 ? (
            <p className="flex items-center gap-2 text-foreground">
              <Check className="size-4 text-success" aria-hidden="true" />
              Correct: {correctOptionIndices.map((i) => data[i]?.label).filter(Boolean).join(", ")}
            </p>
          ) : null}
          {explanation ? <p className="text-muted-foreground">{explanation}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
