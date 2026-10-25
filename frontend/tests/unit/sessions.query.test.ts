import { describe, expect, test } from "bun:test";

import {
  answeredShare,
  answerTone,
  asRevealDistribution,
  chartedSlides,
  defaultExpiryChoice,
  exportFileFallback,
  exportOptions,
  expiryFor,
  expiryLabel,
  filterParticipants,
  formatDuration,
  formatPercent,
  formatResponseTime,
  pageOf,
  publicSlides,
  reportPath,
  resultsPath,
  sessionsPath,
  shareUrl,
  skippedSlides,
  summaryPath,
  toStageSlide,
} from "@/features/sessions/query";
import type { PublicResultSlide, ReportParticipant, ReportSlide } from "@/features/sessions/types";

const participant = (n: number, overrides: Partial<ReportParticipant> = {}): ReportParticipant => ({
  participantId: `p${n}`,
  name: `Player ${n}`,
  rank: n,
  score: 1000 - n,
  correctCount: 1,
  answeredCount: 2,
  joinedAt: "2026-03-02T09:00:00.000Z",
  kicked: false,
  ...overrides,
});

const slide = (overrides: Partial<ReportSlide> = {}): ReportSlide => ({
  slideId: "s1",
  slideIndex: 0,
  type: "select_answer",
  typeName: "Select answer",
  kind: "interactive",
  lifecycle: "response",
  label: "Q",
  scored: true,
  visited: true,
  phase: "closed",
  answeredCount: 3,
  distribution: null,
  slide: {},
  ...overrides,
});

describe("formatting", () => {
  test("durations read as seconds, minutes, or hours and minutes", () => {
    expect(formatDuration(35_000)).toBe("35 s");
    expect(formatDuration(42 * 60_000)).toBe("42 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05 min");
    expect(formatDuration(0)).toBe("0 s");
    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(-5)).toBe("-");
    expect(formatDuration(Number.NaN)).toBe("-");
  });

  test("percentages clamp to 0-100 and round", () => {
    expect(formatPercent(0.4166)).toBe("42%");
    expect(formatPercent(1.7)).toBe("100%");
    expect(formatPercent(-1)).toBe("0%");
    expect(formatPercent(null)).toBe("-");
  });

  test("response times show one decimal", () => {
    expect(formatResponseTime(4250)).toBe("4.3 s");
    expect(formatResponseTime(0)).toBe("0.0 s");
    expect(formatResponseTime(null)).toBe("-");
  });
});

describe("links", () => {
  test("report and list paths nest under the deck", () => {
    expect(sessionsPath("d1")).toBe("/presentations/d1/sessions");
    expect(reportPath("d1", "s9")).toBe("/presentations/d1/sessions/s9");
  });

  test("the public link is /r/<token> on the current origin, with no double slash", () => {
    expect(resultsPath("abc_-123")).toBe("/r/abc_-123");
    expect(shareUrl("https://app.example.com/", "tok")).toBe("https://app.example.com/r/tok");
    expect(shareUrl("http://localhost:3000", "tok")).toBe("http://localhost:3000/r/tok");
  });

  test("the take-home link pins the session when known", () => {
    expect(summaryPath("123456")).toBe("/live/123456/summary");
    expect(summaryPath("123456", "6ad5d9312eac91a3ea9e5ecb")).toBe("/live/123456/summary?sid=6ad5d9312eac91a3ea9e5ecb");
    expect(summaryPath("123456", null)).toBe("/live/123456/summary");
  });
});

describe("exports", () => {
  test("every format is listed once, marked by what the plan includes", () => {
    const options = exportOptions({ exports: { plan: "free", csv: true, xlsx: false, pdf: false } });
    expect(options.map((o) => [o.format, o.included])).toEqual([
      ["csv", true],
      ["xlsx", false],
      ["pdf", false],
    ]);
    expect(exportOptions({ exports: { plan: "pro", csv: true, xlsx: true, pdf: true } }).every((o) => o.included)).toBe(true);
  });

  test("the fallback file name matches the server's slug", () => {
    expect(exportFileFallback("Q3 All-Hands!", 4, "csv")).toBe("q3-all-hands-run-4.csv");
    expect(exportFileFallback("", 1, "pdf")).toBe("session-run-1.pdf");
  });
});

describe("share expiry", () => {
  const now = Date.parse("2026-03-02T12:00:00Z");

  test("choices resolve to an ISO date relative to now, or null", () => {
    expect(expiryFor("never", now)).toBeNull();
    expect(expiryFor("1d", now)).toBe("2026-03-03T12:00:00.000Z");
    expect(expiryFor("7d", now)).toBe("2026-03-09T12:00:00.000Z");
    expect(expiryFor("30d", now)).toBe("2026-04-01T12:00:00.000Z");
  });

  test("the dialog starts on never for a new link, keeps a live expiry, and replaces a lapsed one", () => {
    expect(defaultExpiryChoice(null, now)).toBe("never");
    expect(defaultExpiryChoice({ expiresAt: null }, now)).toBe("keep");
    expect(defaultExpiryChoice({ expiresAt: "2026-03-05T00:00:00Z" }, now)).toBe("keep");
    expect(defaultExpiryChoice({ expiresAt: "2026-03-01T00:00:00Z" }, now)).toBe("7d");
  });

  test("labels say whether the link expires or expired", () => {
    expect(expiryLabel(null, now)).toBe("Never expires");
    expect(expiryLabel("2026-03-05T00:00:00Z", now, "en-US")).toStartWith("Expires ");
    expect(expiryLabel("2026-03-01T00:00:00Z", now, "en-US")).toStartWith("Expired ");
  });
});

describe("stage views from report data", () => {
  test("a stored slide keeps its answer keys and gets the fields the views read", () => {
    const stage = toStageSlide({
      _id: "s1",
      type: "select_answer",
      question: "Capital?",
      options: [
        { text: "Paris", isCorrect: true },
        { text: "Lyon", isCorrect: false },
      ],
      points: 1000,
      timeLimit: 20,
    });
    expect(stage.options).toEqual([
      { text: "Paris", isCorrect: true },
      { text: "Lyon", isCorrect: false },
    ]);
    expect(stage).toMatchObject({ type: "select_answer", question: "Capital?", points: 1000, scaleMax: 5, maxEntries: 3, statements: [], items: [] });
  });

  test("a participant-facing slide (no answer keys) defaults every option to not correct", () => {
    const stage = toStageSlide({ type: "select_answer", question: "Q", options: [{ text: "A" }, { text: "B" }], points: 0 });
    expect(stage.options.map((o) => o.isCorrect)).toEqual([false, false]);
  });

  test("garbage in a stored slide never throws", () => {
    const stage = toStageSlide({ type: "scales", question: 5, options: "x", statements: [1, "ok"], scaleMax: "9" });
    expect(stage.question).toBe("");
    expect(stage.options).toEqual([]);
    expect(stage.statements).toEqual(["ok"]);
    expect(stage.scaleMax).toBe(5);
  });

  test("only distributions with a kind are drawn", () => {
    expect(asRevealDistribution(null)).toBeNull();
    expect(asRevealDistribution({})).toBeNull();
    expect(asRevealDistribution({ kind: "words", words: [] })).toEqual({ kind: "words", words: [] });
  });

  test("shown response slides are charted; unreached ones are listed apart; content slides are neither", () => {
    const slides = [
      slide({ slideId: "a" }),
      slide({ slideId: "b", visited: false }),
      slide({ slideId: "c", lifecycle: "content", visited: true }),
      slide({ slideId: "d", lifecycle: "system" }),
    ];
    expect(chartedSlides(slides).map((s) => s.slideId)).toEqual(["a"]);
    expect(skippedSlides(slides).map((s) => s.slideId)).toEqual(["b"]);
  });

  test("public slides come in deck order", () => {
    const make = (slideIndex: number) => ({ slideIndex }) as PublicResultSlide;
    expect(publicSlides([make(3), make(1), make(2)]).map((s) => s.slideIndex)).toEqual([1, 2, 3]);
  });
});

describe("participants table", () => {
  const all = Array.from({ length: 60 }, (_, i) => participant(i + 1));

  test("filters by name, case-insensitively, keeping rank order", () => {
    expect(filterParticipants(all, "  player 5 ").map((p) => p.name)).toEqual([
      "Player 5",
      "Player 50",
      "Player 51",
      "Player 52",
      "Player 53",
      "Player 54",
      "Player 55",
      "Player 56",
      "Player 57",
      "Player 58",
      "Player 59",
    ]);
    expect(filterParticipants(all, "")).toBe(all);
    expect(filterParticipants(all, "zzz")).toEqual([]);
  });

  test("pages clamp to the available range", () => {
    expect(pageOf(all, 0).rows).toHaveLength(25);
    expect(pageOf(all, 2).rows).toHaveLength(10);
    expect(pageOf(all, 2).pages).toBe(3);
    expect(pageOf(all, 99).page).toBe(2);
    expect(pageOf(all, -4).page).toBe(0);
    expect(pageOf([], 0)).toEqual({ rows: [], pages: 1, page: 0 });
  });

  test("answered share is a percentage of the response slides", () => {
    expect(answeredShare({ answeredCount: 3 }, 4)).toBe("75%");
    expect(answeredShare({ answeredCount: 0 }, 0)).toBe("-");
  });
});

describe("take-home tones", () => {
  test("correctness stays pending until the server reveals it", () => {
    expect(answerTone({ scored: true, answered: true, isCorrect: null })).toBe("pending");
    expect(answerTone({ scored: true, answered: true, isCorrect: true })).toBe("correct");
    expect(answerTone({ scored: true, answered: true, isCorrect: false })).toBe("wrong");
    expect(answerTone({ scored: false, answered: true, isCorrect: null })).toBe("unscored");
    expect(answerTone({ scored: true, answered: false, isCorrect: null })).toBe("skipped");
  });
});
