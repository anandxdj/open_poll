import { apiClient } from "@/lib/api-client";

// Workspace insights (`GET /api/insights`, backend/src/modules/insights) and the
// pure helpers the overview page formats them with. Wire types mirror
// backend/src/modules/insights/insights.contract.ts.

export interface InsightsTotals {
  sessions: number;
  participants: number;
  sessionAnswers: number;
  pollResponses: number;
  responses: number;
  engagement: number | null;
  decksRun: number;
}

export interface InsightsDay {
  date: string;
  sessions: number;
  participants: number;
  responses: number;
}

export interface InsightsTopItem {
  type: "presentation" | "poll";
  id: string;
  title: string;
  people: number;
  runs: number | null;
  lastActivityAt: string;
}

export interface InsightsRecentSession {
  sessionId: string;
  presentationId: string;
  title: string;
  runNumber: number;
  status: "lobby" | "active" | "ended";
  isLive: boolean;
  startedAt: string;
  participantCount: number;
  answerCount: number;
  participationRate: number | null;
}

export interface Insights {
  range: { from: string; to: string; days: number; tz: string };
  totals: InsightsTotals;
  previous: InsightsTotals;
  daily: InsightsDay[];
  top: InsightsTopItem[];
  recentSessions: InsightsRecentSession[];
  liveNow: { sessions: number; polls: number };
}

/** Ranges the page offers, in days. */
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The viewer's time zone, so a day on the chart is their day; UTC when the browser can't say. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** The last `days` days up to `now`. */
export function rangeFor(days: number, now = Date.now()) {
  return { from: new Date(now - days * DAY_MS).toISOString(), to: new Date(now).toISOString() };
}

export async function fetchInsights(days: RangeDays, signal?: AbortSignal): Promise<Insights> {
  const res = await apiClient.get<{ data: Insights }>("/insights", {
    params: { ...rangeFor(days), tz: viewerTimeZone() },
    signal,
  });
  return res.data.data;
}

// ---------- Change against the previous period ----------

export type Trend = "up" | "down" | "flat";

export interface Change {
  trend: Trend;
  /** e.g. "+18%", "−3", "+4 pts"; null when there is nothing to compare with. */
  amount: string | null;
}

const signed = (value: number, unit = "") => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US")}${unit}`;

/**
 * A count against the previous period: a percentage when there was something
 * before, the plain difference when the previous period was empty.
 */
export function countChange(current: number, previous: number): Change {
  if (current === previous) return { trend: "flat", amount: current === 0 ? null : "0%" };
  const trend: Trend = current > previous ? "up" : "down";
  if (previous === 0) return { trend, amount: signed(current - previous) };
  return { trend, amount: signed(Math.round(((current - previous) / previous) * 100), "%") };
}

/** A rate (0–1) against the previous period, in percentage points. */
export function rateChange(current: number | null, previous: number | null): Change {
  if (current === null || previous === null) return { trend: "flat", amount: null };
  const points = Math.round((current - previous) * 100);
  if (points === 0) return { trend: "flat", amount: "0 pts" };
  return { trend: points > 0 ? "up" : "down", amount: signed(points, " pts") };
}

export const formatPercent = (rate: number | null) => (rate === null ? "–" : `${Math.round(rate * 100)}%`);

/** "Oct 12" for a `YYYY-MM-DD` day key (no time zone shift: the key already is the viewer's day). */
export function formatDay(key: string, withYear = false): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "2 hours ago" style, for recent activity. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < 60) return "just now";
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), "hour");
  if (seconds < 86400 * 30) return rtf.format(-Math.round(seconds / 86400), "day");
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
