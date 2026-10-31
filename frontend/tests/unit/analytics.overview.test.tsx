import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  HeadlineNumbers,
  LiveNow,
  RecentSessions,
  TopContent,
} from "@/features/analytics/components/InsightsOverview";
import type { Insights, InsightsTotals } from "@/features/analytics/insights";

const totals = (over: Partial<InsightsTotals> = {}): InsightsTotals => ({
  sessions: 12,
  participants: 284,
  sessionAnswers: 1500,
  pollResponses: 403,
  responses: 1903,
  engagement: 0.76,
  decksRun: 5,
  ...over,
});

const insights = (over: Partial<Insights> = {}): Insights => ({
  range: { from: "2026-09-26T00:00:00.000Z", to: "2026-10-26T00:00:00.000Z", days: 30, tz: "UTC" },
  totals: totals(),
  previous: totals({ sessions: 9, participants: 241, responses: 1903, engagement: 0.72 }),
  daily: [],
  top: [
    { type: "presentation", id: "d1", title: "Team quiz night", people: 124, runs: 3, lastActivityAt: "2026-10-25T10:00:00.000Z" },
    { type: "poll", id: "p1", title: "Office hours", people: 96, runs: null, lastActivityAt: "2026-10-24T10:00:00.000Z" },
  ],
  recentSessions: [
    {
      sessionId: "s2",
      presentationId: "d1",
      title: "Team quiz night",
      runNumber: 3,
      status: "active",
      isLive: true,
      startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      participantCount: 31,
      answerCount: 40,
      participationRate: null,
    },
    {
      sessionId: "s1",
      presentationId: "d1",
      title: "Team quiz night",
      runNumber: 2,
      status: "ended",
      isLive: false,
      startedAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
      participantCount: 40,
      answerCount: 120,
      participationRate: 0.75,
    },
  ],
  liveNow: { sessions: 1, polls: 2 },
  ...over,
});

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("analytics overview", () => {
  test("headline numbers show the value and the change against the previous period", () => {
    const markup = html(<HeadlineNumbers data={insights()} />);
    expect(markup).toContain("284");
    expect(markup).toContain("1,903");
    expect(markup).toContain("76%");
    expect(markup).toContain("+33%"); // sessions 12 vs 9
    expect(markup).toContain("+18%"); // participants 284 vs 241
    expect(markup).toContain("+4 pts");
    expect(markup).toContain("0%"); // responses unchanged
    expect(markup).toContain("vs previous 30 days");
  });

  test("headline numbers say when there is nothing to compare", () => {
    const empty = totals({ sessions: 0, participants: 0, responses: 0, sessionAnswers: 0, pollResponses: 0, engagement: null });
    const markup = html(<HeadlineNumbers data={insights({ totals: empty, previous: empty })} />);
    expect(markup.match(/Nothing to compare yet/g)).toHaveLength(4);
  });

  test("top content links decks to their sessions and polls to their analytics", () => {
    const markup = html(<TopContent data={insights()} />);
    expect(markup).toContain('href="/presentations/d1/sessions"');
    expect(markup).toContain('href="/analytics/p1"');
    expect(markup).toContain("Deck, 3 sessions");
    expect(markup).toContain("participants");
    expect(markup).toContain("responses");
    expect(html(<TopContent data={insights({ top: [] })} />)).toContain("Nothing was presented or answered");
  });

  test("recent sessions open their report and mark live ones", () => {
    const markup = html(<RecentSessions data={insights()} />);
    expect(markup).toContain('href="/presentations/d1/sessions/s2"');
    expect(markup).toContain("Live");
    expect(markup).toContain("Session 2, 3 days ago");
    expect(markup).toContain("75%");
    expect(html(<RecentSessions data={insights({ recentSessions: [] })} />)).toContain("No live sessions in this range.");
  });

  test("live now names what is running, or nothing", () => {
    expect(html(<LiveNow data={insights()} />)).toContain("1 session and 2 polls live now");
    expect(html(<LiveNow data={insights({ liveNow: { sessions: 0, polls: 0 } })} />)).toBe("");
  });

  test("loading shows placeholders, not numbers", () => {
    const markup = html(<HeadlineNumbers data={null} />);
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toContain("vs previous");
  });
});
