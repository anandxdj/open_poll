import { describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { StageView } from "@/features/presentations/components/stage/StageView";
import { toDraftPayload, toSavePayload, validateDeck } from "@/features/presentations/components/builder/deckDraft";
import {
  blankSlide,
  cleanSlide,
  normalizeSlideForDraft,
  SLIDE_EDITORS,
  validateSlide,
} from "@/features/presentations/slides/editor";
import { slideLabel, slideMetaInSection } from "@/features/presentations/slides/meta";
import { getSlideRuntime, type StageLiveData, type StageMode } from "@/features/presentations/slides/runtime";
import {
  centerPosition,
  completePositions,
  axisIssue,
  gridConfig,
  nearestPlaced,
  nextUnplaced,
  nudgePosition,
  parseGridDistribution,
  positionAt,
  rawGridConfig,
} from "@/features/presentations/slides/types/grid_2x2/config";
import {
  DEFAULT_GUESS_CONFIG,
  guessConfigIssue,
  guessNumberConfig,
  rawGuessConfig,
  snapGuess,
} from "@/features/presentations/slides/types/guess_number/config";
import {
  emptyGuessDistribution,
  isCorrectBucket,
  parseGuessDistribution,
} from "@/features/presentations/slides/types/guess_number/distribution";
import {
  hundredPointsItems,
  isCompleteAnswer,
  parseHundredPointsDistribution,
  remainingPoints,
  toPointValue,
  withPoints,
  withPointsWithinTotal,
} from "@/features/presentations/slides/types/hundred_points/config";
import {
  moveCursor,
  parsePinDistribution,
  pinAt,
  pinImageOf,
  pinRegion,
  rawRegion,
  regionBetween,
  regionIssue,
} from "@/features/presentations/slides/types/pin_on_image/config";
import type { LiveSlide, PresentationSlide, PresentationSlideType, RevealDistribution } from "@/features/presentations/types";

/**
 * The four advanced interactive types (W2-E): editor contract (blank →
 * validate → clean → draft) mirroring the backend schemas, the pure helpers
 * behind the views, and the participant and stage views. Server payloads in
 * the fixtures are the shapes the backend produces (backend/tests/presentations/advanced.test.ts).
 */

const ADVANCED = ["guess_number", "hundred_points", "grid_2x2", "pin_on_image"] as const;

const html = (node: ReactNode) => renderToStaticMarkup(<LiveIntlProvider>{node}</LiveIntlProvider>);

const withQuestion = (slide: PresentationSlide): PresentationSlide => ({ ...slide, question: "  Question?  " });

const NO_LIVE: StageLiveData = { distribution: null, answeredCount: 0, leaderboard: [] };
const liveWith = (distribution: unknown, answeredCount = 0): StageLiveData => ({
  distribution: distribution as RevealDistribution,
  answeredCount,
  leaderboard: [],
});

const stage = (slide: PresentationSlide, mode: StageMode, distribution?: unknown) =>
  html(<StageView slide={slide} mode={mode} live={distribution === undefined ? NO_LIVE : liveWith(distribution)} />);

/** What the server sends a participant for `slide` (the `sanitize` allow-list). */
const liveSlide = (slide: PresentationSlide, extra: Record<string, unknown>): LiveSlide =>
  ({
    slideIndex: 0,
    totalSlides: 1,
    type: slide.type,
    scored: slide.points > 0,
    question: slide.question,
    timeLimit: slide.timeLimit,
    points: slide.points,
    scoreDependsOnTime: slide.scoreDependsOnTime,
    options: [],
    statements: [],
    minLabel: "",
    maxLabel: "",
    scaleMax: 5,
    items: [],
    maxEntries: 3,
    ...extra,
  }) as LiveSlide;

const participant = (slide: PresentationSlide, extra: Record<string, unknown>, mode: "live" | "preview" = "live") => {
  const { ParticipantView } = getSlideRuntime(slide.type)!;
  return html(<ParticipantView slide={liveSlide(slide, extra)} mode={mode} onSubmit={() => {}} submitting={false} />);
};

const editorHtml = (slide: PresentationSlide) =>
  renderToStaticMarkup(createElement(SLIDE_EDITORS[slide.type].Editor, { slide, onChange: () => {} }));

const switchOn = (markup: string, name: string) =>
  new RegExp(`aria-checked="true"[^>]*id="[^"]*"|id="[^"]*"[^>]*aria-checked="true"`).test(markup) && markup.includes(name);

// ---------------------------------------------------------------------------
// Fixtures: a valid, saved slide of each type
// ---------------------------------------------------------------------------

const GUESS: PresentationSlide = {
  ...blankSlide("guess_number"),
  question: "How many moons does Jupiter have?",
  points: 500,
  scoreDependsOnTime: false,
  config: { min: 0, max: 100, step: 1, correct: 79, tolerance: 3 },
};
const POINTS: PresentationSlide = {
  ...blankSlide("hundred_points"),
  question: "Where should we invest?",
  config: { items: ["Docs", "Tests", "Speed"] },
};
const GRID: PresentationSlide = {
  ...blankSlide("grid_2x2"),
  question: "Place the ideas",
  config: {
    items: ["Dark mode", "Offline"],
    x: { label: "Effort", min: 0, max: 10 },
    y: { label: "Impact", min: -5, max: 5 },
  },
};
const PIN: PresentationSlide = {
  ...blankSlide("pin_on_image"),
  question: "Where is Paris?",
  points: 300,
  scoreDependsOnTime: false,
  content: { key: null, url: "https://img.example/map.png", alt: "Map of France" },
  config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } },
};

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

describe("advanced slide registries", () => {
  test("the picker has an Advanced section with the four types in order", () => {
    expect(slideMetaInSection("advanced").map((m) => m.type)).toEqual([...ADVANCED]);
  });

  test("guess_number and pin_on_image can award points; the other two never do", () => {
    const scored = (type: PresentationSlideType) => SLIDE_EDITORS[type].meta.scored;
    expect(ADVANCED.map(scored)).toEqual([true, false, false, true]);
  });

  test("every type is an answerable `response` slide with a runtime", () => {
    for (const type of ADVANCED) expect(getSlideRuntime(type)?.lifecycle).toBe("response");
  });

  test("blank slides start ungraded with their own settings", () => {
    expect(blankSlide("guess_number")).toMatchObject({ points: 0, scoreDependsOnTime: false, config: DEFAULT_GUESS_CONFIG });
    expect(blankSlide("hundred_points")).toMatchObject({ points: 0, timeLimit: 60, config: { items: ["", ""] } });
    expect(blankSlide("grid_2x2")).toMatchObject({
      points: 0,
      config: { items: ["", ""], x: { label: "", min: 0, max: 10 }, y: { label: "", min: 0, max: 10 } },
    });
    expect(blankSlide("pin_on_image")).toMatchObject({
      points: 0,
      content: { key: null, url: null, alt: "" },
      config: { region: null },
    });
    // Fresh objects each time: editing one never changes the next.
    expect(blankSlide("hundred_points").config).not.toBe(blankSlide("hundred_points").config);
  });

  test("slides are labelled by their question, else the type", () => {
    expect(slideLabel(GUESS)).toBe("How many moons does Jupiter have?");
    expect(slideLabel(blankSlide("pin_on_image"))).toBe("Pin on Image");
  });
});

// ---------------------------------------------------------------------------
// guess_number
// ---------------------------------------------------------------------------

describe("guess_number", () => {
  const guess = (config: Record<string, unknown>, patch: Partial<PresentationSlide> = {}): PresentationSlide => ({
    ...GUESS,
    ...patch,
    config: { ...GUESS.config, ...config },
  });

  test("settings read with defaults and fall back like the backend", () => {
    expect(guessNumberConfig({})).toEqual(DEFAULT_GUESS_CONFIG);
    expect(guessNumberConfig({ config: { min: 10, max: 20, step: 5, correct: 15, tolerance: 1 } })).toEqual({
      min: 10,
      max: 20,
      step: 5,
      correct: 15,
      tolerance: 1,
    });
    // An unusable range or step gives the views the defaults; the editor keeps what was typed.
    expect(guessNumberConfig({ config: { min: 5, max: 5 } })).toEqual(DEFAULT_GUESS_CONFIG);
    expect(guessNumberConfig({ config: { step: 0 } })).toEqual(DEFAULT_GUESS_CONFIG);
    expect(rawGuessConfig({ config: { min: 5, max: 5, correct: "x", tolerance: -2 } })).toEqual({
      min: 5,
      max: 5,
      step: 1,
      correct: null,
      tolerance: 0,
    });
    expect(guessNumberConfig({ config: "junk" })).toEqual(DEFAULT_GUESS_CONFIG);
  });

  test("settings problems carry the backend's rules", () => {
    const issue = (patch: Record<string, number | null>, graded = true) =>
      guessConfigIssue({ ...DEFAULT_GUESS_CONFIG, correct: 50, ...patch }, graded);
    expect(issue({})).toBeNull();
    expect(issue({ min: 10, max: 10 })).toBe("max must be greater than min.");
    expect(issue({ step: 0 })).toBe("step must be greater than 0.");
    expect(issue({ step: 101 })).toBe("step must fit between min and max.");
    expect(issue({ max: 1_000_000_000, step: 0.5 })).toBe("use a larger step: at most 1,000,000 steps between min and max.");
    expect(issue({ max: 1, step: 0.00001 })).toBe("use at most 4 decimal places.");
    expect(issue({ min: -2_000_000_000 })).toBe("min and max must be within ±1,000,000,000.");
    expect(issue({ tolerance: -1 })).toBe("tolerance cannot be negative.");
    expect(issue({ correct: null })).toBe("enter the correct number, or turn grading off.");
    expect(issue({ correct: null }, false)).toBeNull();
    expect(issue({ correct: 101 })).toBe("the correct number must be between min and max.");
    expect(issue({ correct: 50.5 })).toBe("the correct number must be on the slider steps.");
    expect(issue({ step: 5, correct: 52 })).toBe("the correct number must be on the slider steps.");
    expect(issue({ step: 0.1, correct: 0.3 })).toBeNull();
  });

  test("snapGuess clamps into the range and onto the steps without float noise", () => {
    const c = { min: 0, max: 1, step: 0.1 };
    expect(snapGuess(0.3, c)).toBe(0.3);
    expect(snapGuess(0.34, c)).toBe(0.3);
    expect(snapGuess(7, c)).toBe(1);
    expect(snapGuess(-3, c)).toBe(0);
    expect(snapGuess(25, { min: 0, max: 100, step: 10 })).toBe(30);
    expect(snapGuess(-0.4, { min: -10, max: 10, step: 0.5 })).toBe(-0.5);
  });

  test("bars are correct when one of their values is within the tolerance", () => {
    const bar = (from: number, to: number) => ({ from, to, count: 0 });
    expect(isCorrectBucket(bar(77, 87), 79, 3, 1)).toBe(true);
    expect(isCorrectBucket(bar(66, 76), 79, 3, 1)).toBe(true); // 76 = 79 − 3
    expect(isCorrectBucket(bar(55, 65), 79, 3, 1)).toBe(false);
    expect(isCorrectBucket(bar(0, 10), null, 3, 1)).toBe(false);
    expect(isCorrectBucket(bar(80, 80), 79, 0, 1)).toBe(false);
    expect(isCorrectBucket(bar(79, 79), 79, 0, 1)).toBe(true);
    // A bar of 5-step values only counts if one of its values is close enough.
    expect(isCorrectBucket(bar(70, 80), 77, 1, 5)).toBe(false);
    expect(isCorrectBucket(bar(70, 80), 77, 1, 1)).toBe(true);
    expect(isCorrectBucket(bar(70, 80), 76, 1, 5)).toBe(true); // 75 is within 1 of 76
  });

  test("results parse from the server's shape and ignore garbage", () => {
    const server = {
      kind: "guess_number",
      min: 0,
      max: 100,
      step: 1,
      count: 2,
      mean: 50,
      median: 50,
      buckets: [
        { from: 0, to: 10, count: 1 },
        { from: 11, to: 21, count: 0 },
        { from: "x", to: 3, count: 1 },
      ],
      correct: 79,
      tolerance: 3,
      correctCount: 1,
    };
    expect(parseGuessDistribution(server)).toEqual({
      min: 0,
      max: 100,
      step: 1,
      count: 2,
      mean: 50,
      median: 50,
      buckets: [
        { from: 0, to: 10, count: 1 },
        { from: 11, to: 21, count: 0 },
      ],
      correct: 79,
      tolerance: 3,
      correctCount: 1,
    });
    expect(parseGuessDistribution({ kind: "options", counts: [] })).toBeNull();
    expect(parseGuessDistribution(null)).toBeNull();
    expect(parseGuessDistribution({ kind: "guess_number", count: -4, mean: "n/a" })).toMatchObject({
      count: 0,
      mean: null,
      buckets: [],
    });
  });

  test("empty results have the server's bars: one per value for small ranges, ten-ish groups for wide ones", () => {
    const wide = emptyGuessDistribution(DEFAULT_GUESS_CONFIG);
    expect(wide.buckets).toHaveLength(10);
    expect(wide.buckets[0]).toEqual({ from: 0, to: 10, count: 0 });
    expect(wide.buckets.at(-1)).toEqual({ from: 99, to: 100, count: 0 });
    const small = emptyGuessDistribution({ min: 1, max: 5, step: 1, correct: null, tolerance: 0 });
    expect(small.buckets.map((b) => [b.from, b.to])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ]);
    const decimals = emptyGuessDistribution({ min: 0, max: 1, step: 0.25, correct: null, tolerance: 0 });
    expect(decimals.buckets.map((b) => b.from)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  describe("editor", () => {
    const def = SLIDE_EDITORS.guess_number;

    test("a blank slide needs a question first, then saves as an ungraded slide", () => {
      expect(def.validate(def.clean(def.blank()))).toBe("question text is missing.");
      const cleaned = def.clean(withQuestion(def.blank()));
      expect(def.validate(cleaned)).toBeNull();
      expect(cleaned).toMatchObject({
        question: "Question?",
        points: 0,
        scoreDependsOnTime: false,
        config: { min: 0, max: 100, step: 1, correct: null, tolerance: 0 },
      });
      expect(def.clean(cleaned)).toEqual(cleaned);
    });

    test("a graded slide needs a correct number and a timer", () => {
      expect(validateSlide(cleanSlide(guess({ correct: null })))).toBe("enter the correct number, or turn grading off.");
      expect(validateSlide(cleanSlide(guess({ correct: 200 })))).toBe("the correct number must be between min and max.");
      expect(validateSlide(cleanSlide(guess({}, { timeLimit: 0 })))).toBe(
        "scored slides need a timer of at least 5 seconds."
      );
      expect(validateSlide(cleanSlide(GUESS))).toBeNull();
      expect(validateDeck("Deck", [cleanSlide(guess({ max: 0 }))])).toBe("Slide 1: max must be greater than min.");
    });

    test("an ungraded slide drops the correct number and tolerance; graded keeps them", () => {
      const ungraded = cleanSlide(guess({}, { points: 0, scoreDependsOnTime: true }));
      expect(ungraded).toMatchObject({
        points: 0,
        scoreDependsOnTime: false,
        config: { correct: null, tolerance: 0 },
      });
      expect(validateSlide(ungraded)).toBeNull();
      expect(cleanSlide(GUESS)).toMatchObject({ points: 500, config: { correct: 79, tolerance: 3 } });
      expect(def.clean(cleanSlide(GUESS))).toEqual(cleanSlide(GUESS));
    });

    test("saved slides reach the API unchanged", () => {
      const saved = cleanSlide(GUESS);
      expect(toSavePayload("Deck", [{ ...saved, _id: "s1" }]).slides[0]).toEqual(saved);
    });

    test("drafts fill what the API needs: a usable range, a correct number on the steps, a timer", () => {
      const draft = normalizeSlideForDraft(
        guess({ min: 5, max: 5, step: 0, correct: 52.4, tolerance: 0.123456 }, { timeLimit: 0 })
      );
      expect(draft.config).toMatchObject({ min: 0, max: 100, step: 1, correct: 52, tolerance: 0.1235 });
      expect(draft.timeLimit).toBe(30);
      expect(toDraftPayload("", [blankSlide("guess_number")]).slides[0]).toMatchObject({
        question: "Untitled Question",
        points: 0,
        config: DEFAULT_GUESS_CONFIG,
      });
    });

    test("the editor shows the graded controls only while graded", () => {
      const graded = editorHtml(GUESS);
      expect(graded).toContain("Correct number");
      expect(graded).toContain("Tolerance (±)");
      expect(graded).toContain('value="79"');
      const ungraded = editorHtml({ ...GUESS, points: 0 });
      expect(ungraded).not.toContain("Correct number");
      expect(ungraded).toContain("Results only");
      expect(editorHtml(guess({ max: 0 }))).toContain("Max must be greater than min.");
      expect(switchOn(graded, "Graded")).toBe(true);
    });
  });

  describe("views", () => {
    const sanitized = { config: { min: 0, max: 100, step: 5 } };

    test("participants get a slider and a number field over the range, starting mid-way", () => {
      const view = participant(GUESS, sanitized);
      expect(view).toContain('type="range"');
      expect(view).toContain('min="0"');
      expect(view).toContain('max="100"');
      expect(view).toContain('step="5"');
      expect(view).toContain('value="50"');
      expect(view).toContain('aria-label="Your guess"');
      expect(view).toContain("Or type your guess");
      expect(view).toContain("Submit Guess");
      expect(view).not.toContain(' disabled=""');
    });

    test("a preview is inert", () => {
      const view = participant(GUESS, sanitized, "preview");
      expect(view.match(/ disabled=""/g)).toHaveLength(3);
    });

    test("a missing config shows the default slider", () => {
      expect(participant(GUESS, {})).toContain('max="100"');
    });

    test("the stage draws the histogram without giving the answer away", () => {
      const dist = {
        ...emptyGuessDistribution({ ...DEFAULT_GUESS_CONFIG, correct: 79, tolerance: 3 }),
        kind: "guess_number",
        count: 3,
        mean: 61.33,
        median: 80,
        correctCount: 2,
      };
      dist.buckets = dist.buckets.map((b, i) => ({ ...b, count: i === 7 ? 2 : i === 1 ? 1 : 0 }));
      const live = stage(GUESS, "live", dist);
      expect(live).toContain("61.33");
      expect(live).toContain("Mean");
      expect(live).toContain("Median");
      expect(live).toContain("77–87: 2 guesses");
      expect(live).not.toContain("Correct answer");
      expect(live).not.toContain("bg-gradient-to-t from-deck-correct");
      const revealed = stage(GUESS, "reveal", dist);
      expect(revealed).toContain("Correct answer");
      expect(revealed).toContain("79 ± 3");
      expect(revealed).toContain("2 of 3 guesses were correct");
      // The bars reaching 76–82 light up: the filled one turns green, both labels do.
      expect(revealed.match(/from-deck-correct to-deck-correct-alt/g)).toHaveLength(1);
      expect(revealed.match(/tabular-nums font-bold text-deck-correct-soft/g)).toHaveLength(2);
      expect(stage(GUESS, "report", dist)).toContain("Correct answer");
    });

    test("an ungraded slide never shows a correct answer", () => {
      const dist = { ...emptyGuessDistribution(DEFAULT_GUESS_CONFIG), kind: "guess_number", count: 1, correct: null };
      expect(stage({ ...GUESS, points: 0 }, "reveal", dist)).not.toContain("Correct answer");
    });

    test("without results the stage and its thumbnail show the empty bars", () => {
      const empty = stage(GUESS, "live");
      expect(empty).toContain("0–10");
      expect(empty).toContain("Guesses");
      const thumb = stage(GUESS, "thumbnail", { kind: "guess_number", count: 9, buckets: [] });
      expect(thumb).not.toContain("Mean");
      expect(thumb).not.toContain("Correct answer");
      expect(thumb).toContain("0–10");
    });
  });
});

// ---------------------------------------------------------------------------
// hundred_points
// ---------------------------------------------------------------------------

describe("hundred_points", () => {
  const def = SLIDE_EDITORS.hundred_points;
  const points = (items: string[], patch: Partial<PresentationSlide> = {}): PresentationSlide => ({
    ...POINTS,
    ...patch,
    config: { items },
  });

  test("point helpers keep whole numbers from 0 to 100", () => {
    expect(toPointValue(33.6)).toBe(34);
    expect(toPointValue(-5)).toBe(0);
    expect(toPointValue(250)).toBe(100);
    expect(toPointValue(NaN)).toBe(0);
    expect(withPoints([10, 20, 30], 1, 55.4)).toEqual([10, 55, 30]);
    expect(remainingPoints([50, 25])).toBe(25);
    expect(remainingPoints([80, 40])).toBe(-20);
  });

  test("sliders and buttons never give out more than is left", () => {
    expect(withPointsWithinTotal([60, 30, 0], 2, 50)).toEqual([60, 30, 10]);
    expect(withPointsWithinTotal([60, 30, 0], 0, 90)).toEqual([70, 30, 0]);
    expect(withPointsWithinTotal([60, 30, 0], 0, 10)).toEqual([10, 30, 0]);
    expect(withPointsWithinTotal([0, 0], 1, 100)).toEqual([0, 100]);
  });

  test("an answer is complete at exactly 100 whole non-negative points", () => {
    expect(isCompleteAnswer([50, 50, 0], 3)).toBe(true);
    expect(isCompleteAnswer([50, 49, 0], 3)).toBe(false);
    expect(isCompleteAnswer([60, 50, -10], 3)).toBe(false);
    expect(isCompleteAnswer([33.5, 33.5, 33], 3)).toBe(false);
    expect(isCompleteAnswer([100], 2)).toBe(false);
  });

  test("items read from the config", () => {
    expect(hundredPointsItems(POINTS)).toEqual(["Docs", "Tests", "Speed"]);
    expect(hundredPointsItems({})).toEqual([]);
    expect(hundredPointsItems({ config: { items: ["a", 3, null, "b"] } })).toEqual(["a", "b"]);
  });

  test("results parse from the server's shape", () => {
    expect(
      parseHundredPointsDistribution({
        kind: "hundred_points",
        items: [
          { text: "Docs", total: 60, average: 30 },
          { text: "Tests", total: "x", average: -2 },
        ],
        voters: 2,
      })
    ).toEqual({
      items: [
        { text: "Docs", total: 60, average: 30 },
        { text: "Tests", total: 0, average: 0 },
      ],
      voters: 2,
    });
    expect(parseHundredPointsDistribution({ kind: "ranking" })).toBeNull();
  });

  test("editor: 2–10 items, blanks dropped, never scored", () => {
    expect(def.validate(def.clean(def.blank()))).toBe("question text is missing.");
    expect(validateSlide(cleanSlide(withQuestion(def.blank())))).toBe("add at least 2 items.");
    expect(validateSlide(cleanSlide(points(["Only one", "  "])))).toBe("add at least 2 items.");
    expect(validateSlide(cleanSlide(points(Array.from({ length: 11 }, (_, i) => `Item ${i}`))))).toBe(
      "use at most 10 items."
    );
    const cleaned = cleanSlide(points([" Docs ", "", "Tests"], { points: 500, scoreDependsOnTime: true }));
    expect(cleaned).toMatchObject({ points: 0, scoreDependsOnTime: false, config: { items: ["Docs", "Tests"] } });
    expect(validateSlide(cleaned)).toBeNull();
    expect(def.clean(cleaned)).toEqual(cleaned);
    expect(toSavePayload("Deck", [{ ...cleaned, _id: "s1" }]).slides[0]).toEqual(cleaned);
  });

  test("drafts get at least two items", () => {
    expect(normalizeSlideForDraft(blankSlide("hundred_points")).config).toEqual({ items: ["Item 1", "Item 2"] });
    expect(normalizeSlideForDraft(points(["Solo"])).config).toEqual({ items: ["Solo", "Item 2"] });
  });

  test("participants get a slider, buttons and a number field per item, and cannot submit yet", () => {
    const view = participant(POINTS, { config: { items: ["Docs", "Tests", "Speed"] } });
    expect(view).toContain("100 points left to give");
    expect(view.match(/type="range"/g)).toHaveLength(3);
    expect(view.match(/type="number"/g)).toHaveLength(3);
    expect(view).toContain('aria-label="Points for Docs"');
    expect(view).toContain('aria-label="Give Tests 5 points more"');
    expect(view).toContain("Submit Points");
    expect(view).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<span[^>]*>)?Submit Points/);
    expect(participant(POINTS, { config: { items: ["A", "B"] } }, "preview")).toContain("disabled");
  });

  test("the stage lists items in the authored order live and best first once revealed", () => {
    const dist = {
      kind: "hundred_points",
      items: [
        { text: "Docs", total: 60, average: 30 },
        { text: "Tests", total: 70, average: 35 },
        { text: "Speed", total: 70, average: 35 },
      ],
      voters: 2,
    };
    const order = (markup: string) => ["Docs", "Tests", "Speed"].sort((a, b) => markup.indexOf(a) - markup.indexOf(b));
    const live = stage(POINTS, "live", dist);
    expect(order(live)).toEqual(["Docs", "Tests", "Speed"]);
    expect(live).not.toContain("#1");
    expect(live).toContain("2 participants answered");
    const revealed = stage(POINTS, "reveal", dist);
    expect(order(revealed)).toEqual(["Tests", "Speed", "Docs"]);
    expect(revealed).toContain("#1");
    expect(revealed).toContain(">35<");
  });

  test("the thumbnail shows every item at zero", () => {
    const thumb = stage(POINTS, "thumbnail", { kind: "hundred_points", items: [], voters: 5 });
    for (const item of ["Docs", "Tests", "Speed"]) expect(thumb).toContain(item);
    expect(thumb).not.toContain("participants answered");
  });
});

// ---------------------------------------------------------------------------
// grid_2x2
// ---------------------------------------------------------------------------

describe("grid_2x2", () => {
  const def = SLIDE_EDITORS.grid_2x2;
  const X = { label: "Effort", min: 0, max: 10 };
  const Y = { label: "Impact", min: -5, max: 5 };
  const Q0 = { topLeft: "", topRight: "", bottomLeft: "", bottomRight: "" };
  const grid = (config: Record<string, unknown>): PresentationSlide => ({
    ...GRID,
    config: { ...GRID.config, ...config },
  });

  test("settings read with labelled axes and fall back to 0–10 on a broken range", () => {
    expect(gridConfig(GRID)).toEqual({ items: ["Dark mode", "Offline"], x: X, y: Y, quadrants: Q0 });
    expect(gridConfig({})).toEqual({
      items: [],
      x: { label: "Horizontal", min: 0, max: 10 },
      y: { label: "Vertical", min: 0, max: 10 },
      quadrants: Q0,
    });
    expect(gridConfig(grid({ quadrants: { topLeft: " Quick wins ", topRight: 7 } })).quadrants).toEqual({
      ...Q0,
      topLeft: "Quick wins",
    });
    expect(gridConfig(grid({ x: { label: "  ", min: 5, max: 5 } })).x).toEqual({ label: "Horizontal", min: 0, max: 10 });
    expect(rawGridConfig(grid({ x: { label: "A", min: 5, max: 5 } })).x).toEqual({ label: "A", min: 5, max: 5 });
  });

  test("positions map to and from the board, vertical growing upwards", () => {
    expect(positionAt(0, 0, X, Y)).toEqual({ x: 0, y: -5 });
    expect(positionAt(1, 1, X, Y)).toEqual({ x: 10, y: 5 });
    expect(positionAt(0.25, 0.75, X, Y)).toEqual({ x: 2.5, y: 2.5 });
    expect(positionAt(-3, 9, X, Y)).toEqual({ x: 0, y: 5 });
    expect(centerPosition(X, Y)).toEqual({ x: 5, y: 0 });
    expect(positionAt(1 / 3, 0.5, X, Y).x).toBe(3.33);
  });

  test("the keyboard moves an item in steps of a twentieth, starting from the centre", () => {
    expect(nudgePosition(null, "right", X, Y)).toEqual({ x: 5.5, y: 0 });
    expect(nudgePosition({ x: 5.5, y: 0 }, "up", X, Y)).toEqual({ x: 5.5, y: 0.5 });
    expect(nudgePosition({ x: 5, y: 0 }, "left", X, Y, true)).toEqual({ x: 2.5, y: 0 });
    expect(nudgePosition({ x: 9.8, y: 0 }, "right", X, Y)).toEqual({ x: 10, y: 0 });
    expect(nudgePosition({ x: 0, y: -4.8 }, "down", X, Y)).toEqual({ x: 0, y: -5 });
  });

  test("a click grabs the nearest placed item, else it places the selected one", () => {
    const placed = [{ x: 2, y: 3 }, null, { x: 2.5, y: 3.2 }];
    // Item 1 sits at fractions (0.2, 0.8); item 3 at (0.25, 0.82).
    expect(nearestPlaced(placed, 0.21, 0.8, X, Y)).toBe(0);
    expect(nearestPlaced(placed, 0.25, 0.83, X, Y)).toBe(2);
    expect(nearestPlaced(placed, 0.7, 0.2, X, Y)).toBeNull();
    expect(nearestPlaced([null, null], 0.5, 0.5, X, Y)).toBeNull();
  });

  test("the next item to place wraps around; a full board is an answer", () => {
    expect(nextUnplaced([null, { x: 1, y: 1 }, null], 1)).toBe(2);
    expect(nextUnplaced([null, { x: 1, y: 1 }, { x: 2, y: 2 }], 1)).toBe(0);
    expect(nextUnplaced([{ x: 1, y: 1 }], 0)).toBeNull();
    expect(completePositions([{ x: 1.234, y: 2 }, null])).toBeNull();
    expect(completePositions([{ x: 1.234, y: 2 }, { x: 0, y: 5 }])).toEqual([
      { x: 1.23, y: 2 },
      { x: 0, y: 5 },
    ]);
  });

  test("axis problems carry the backend's rules", () => {
    expect(axisIssue(X, "horizontal")).toBeNull();
    expect(axisIssue({ ...X, label: " " }, "horizontal")).toBe("name the horizontal axis.");
    expect(axisIssue({ ...X, label: "x".repeat(41) }, "vertical")).toBe("keep the vertical axis name under 40 characters.");
    expect(axisIssue({ ...X, max: 0 }, "vertical")).toBe("the vertical axis max must be greater than its min.");
    expect(axisIssue({ ...X, max: 1001 }, "horizontal")).toBe("the horizontal axis must stay between -1000 and 1000.");
    expect(axisIssue({ ...X, max: 2.5 }, "horizontal")).toBe("the horizontal axis needs whole numbers.");
  });

  test("results parse from the server's shape", () => {
    const parsed = parseGridDistribution({
      kind: "grid_2x2",
      x: X,
      y: Y,
      quadrants: { topLeft: "Quick wins" },
      items: [
        { text: "Dark mode", x: 3, y: 7, count: 2 },
        { text: "Offline", x: null, y: null, count: 0 },
      ],
      voters: 2,
      placements: [
        [{ x: 2, y: 8 }, { x: 9, y: 3 }],
        [{ x: 4 }, { x: 1, y: 1 }],
        "junk",
      ],
    });
    expect(parsed).toEqual({
      x: X,
      y: Y,
      quadrants: { ...Q0, topLeft: "Quick wins" },
      items: [
        { text: "Dark mode", x: 3, y: 7, count: 2 },
        { text: "Offline", x: null, y: null, count: 0 },
      ],
      voters: 2,
      // Malformed placements are skipped.
      placements: [[{ x: 2, y: 8 }, { x: 9, y: 3 }]],
    });
    expect(parseGridDistribution({ kind: "scales" })).toBeNull();
  });

  test("editor: items, two named axes, never scored", () => {
    expect(def.validate(def.clean(def.blank()))).toBe("question text is missing.");
    expect(validateSlide(cleanSlide(withQuestion(def.blank())))).toBe("add at least one item.");
    const named = withQuestion({ ...def.blank(), config: { ...def.blank().config, items: ["Dark mode"] } });
    expect(validateSlide(cleanSlide(named))).toBe("name the horizontal axis.");
    expect(validateSlide(cleanSlide(grid({ items: ["  "] })))).toBe("add at least one item.");
    expect(validateSlide(cleanSlide(grid({ y: { label: "", min: 0, max: 10 } })))).toBe("name the vertical axis.");
    expect(validateSlide(cleanSlide(grid({ x: { label: "Effort", min: 4, max: 4 } })))).toBe(
      "the horizontal axis max must be greater than its min."
    );
    const cleaned = cleanSlide(
      grid({ items: [" Dark mode ", ""], x: { label: " Effort ", min: 0.4, max: 10.2 }, points: 900 })
    );
    expect(cleaned.config).toEqual({
      items: ["Dark mode"],
      x: { label: "Effort", min: 0, max: 10 },
      y: Y,
      quadrants: Q0,
    });
    expect(validateSlide(cleanSlide(grid({ quadrants: { ...Q0, topLeft: " Quick wins " } })))).toBeNull();
    expect(cleanSlide(grid({ quadrants: { ...Q0, topLeft: " Quick wins " } })).config?.quadrants).toEqual({
      ...Q0,
      topLeft: "Quick wins",
    });
    expect(cleaned.points).toBe(0);
    expect(validateSlide(cleaned)).toBeNull();
    expect(def.clean(cleaned)).toEqual(cleaned);
    expect(validateSlide(cleanSlide(GRID))).toBeNull();
  });

  test("drafts get an item and named axes within range", () => {
    const draft = normalizeSlideForDraft(grid({ items: [], x: { label: "", min: 50, max: 2000 }, y: Y }));
    expect(draft.config).toEqual({
      items: ["Item 1"],
      x: { label: "Horizontal", min: 0, max: 10 },
      y: Y,
      quadrants: Q0,
    });
    expect(normalizeSlideForDraft(blankSlide("grid_2x2")).config).toMatchObject({
      x: { label: "Horizontal" },
      y: { label: "Vertical" },
    });
  });

  test("participants get the labelled board, an item list and a disabled submit", () => {
    const view = participant(GRID, { config: gridConfig(GRID) });
    expect(view).toContain("Grid with Effort across and Impact up");
    expect(view).toContain('tabindex="0"');
    expect(view).toContain("Dark mode");
    expect(view).toContain("Offline");
    expect(view).toContain("0 of 2 placed");
    expect(view).toContain("Tap the grid to place “Dark mode”");
    expect(view).toContain('aria-pressed="true"');
    expect(view).toContain("Submit Grid");
    expect(view).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<span[^>]*>)?Submit Grid/);
    const preview = participant(GRID, { config: gridConfig(GRID) }, "preview");
    expect(preview).toContain('tabindex="-1"');
  });

  test("the stage plots each item at its average position and lists them", () => {
    const dist = {
      kind: "grid_2x2",
      x: X,
      y: Y,
      quadrants: { topLeft: "Quick wins", bottomRight: "Money pits" },
      items: [
        { text: "Dark mode", x: 2.5, y: 2.5, count: 2 },
        { text: "Offline", x: null, y: null, count: 0 },
      ],
      voters: 2,
      placements: [
        [{ x: 2, y: 2 }, { x: 8, y: -4 }],
        [{ x: 3, y: 3 }, { x: 7, y: -3 }],
      ],
    };
    const live = stage(GRID, "live", dist);
    expect(live).toContain("left:25%;top:25%");
    expect(live.match(/data-marker=/g)).toHaveLength(1);
    // A faint dot for each placement: two participants, two items each.
    expect(live.match(/size-1\.5 -translate-x-1\/2/g)).toHaveLength(4);
    expect(live).toContain("Quick wins");
    expect(live).toContain("Money pits");
    expect(live).toContain("Dark mode");
    expect(live).toContain("2.5, 2.5");
    expect(live).toContain("Effort");
    expect(live).toContain("Impact");
    expect(live).toContain("2 participants answered");
    expect(stage(GRID, "reveal", dist).match(/data-marker=/g)).toHaveLength(1);
    const thumb = stage(GRID, "thumbnail", dist);
    expect(thumb).not.toContain("data-marker");
    expect(thumb.match(/size-1\.5 -translate-x-1\/2/g)).toBeNull();
    expect(thumb).toContain("Offline");
  });
});

// ---------------------------------------------------------------------------
// pin_on_image
// ---------------------------------------------------------------------------

describe("pin_on_image", () => {
  const def = SLIDE_EDITORS.pin_on_image;
  const pin = (patch: Partial<PresentationSlide>): PresentationSlide => ({ ...PIN, ...patch });
  const REGION = { x: 0.4, y: 0.2, width: 0.2, height: 0.2 };

  test("the image and the area read defensively", () => {
    expect(pinImageOf(PIN)).toEqual({ key: null, url: "https://img.example/map.png", alt: "Map of France" });
    expect(pinImageOf({})).toEqual({ key: null, url: null, alt: "" });
    expect(pinRegion(PIN)).toEqual(REGION);
    expect(pinRegion({})).toBeNull();
    expect(pinRegion({ config: { region: { x: 0.9, y: 0, width: 0.5, height: 0.5 } } })).toBeNull();
    expect(pinRegion({ config: { region: { x: 0, y: 0, width: 0, height: 0.5 } } })).toBeNull();
    // The editor still sees an area that is out of bounds, to show what is wrong.
    expect(rawRegion({ config: { region: { x: 0.9, y: 0, width: 0.5, height: 0.5 } } })).toEqual({
      x: 0.9,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
  });

  test("area problems carry the backend's rules", () => {
    expect(regionIssue(REGION)).toBeNull();
    expect(regionIssue({ x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(regionIssue({ ...REGION, width: 0.005 })).toBe("the correct area is too small.");
    expect(regionIssue({ ...REGION, x: 0.9 })).toBe("the correct area must lie inside the image.");
    expect(regionIssue({ ...REGION, y: -0.1 })).toBe("the correct area must lie inside the image.");
  });

  test("dragging between two corners gives a rectangle inside the image", () => {
    expect(regionBetween({ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 })).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 });
    expect(regionBetween({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.3 })).toEqual({ x: 0.2, y: 0.3, width: 0.4, height: 0.2 });
    expect(regionBetween({ x: -1, y: 0.2 }, { x: 2, y: 0.4 })).toEqual({ x: 0, y: 0.2, width: 1, height: 0.2 });
  });

  test("pins and the keyboard cursor stay inside the image", () => {
    expect(pinAt(0.123456, 1.4)).toEqual({ x: 0.1235, y: 1 });
    expect(pinAt(-2, 0.5)).toEqual({ x: 0, y: 0.5 });
    expect(moveCursor(null, "right")).toEqual({ x: 0.52, y: 0.5 });
    expect(moveCursor({ x: 0.5, y: 0.5 }, "up", true)).toEqual({ x: 0.5, y: 0.4 });
    expect(moveCursor({ x: 0.99, y: 0.5 }, "right")).toEqual({ x: 1, y: 0.5 });
    expect(moveCursor({ x: 0.5, y: 0.01 }, "up")).toEqual({ x: 0.5, y: 0 });
  });

  test("results parse from the server's shape and drop out-of-range pins", () => {
    const parsed = parsePinDistribution({
      kind: "pin_on_image",
      count: 3,
      pins: [
        { x: 0.1, y: 0.9 },
        { x: 1.5, y: 0.2 },
        { x: "a", y: 0.2 },
      ],
      heat: {
        size: 20,
        cells: [
          { col: 2, row: 18, count: 1 },
          { col: 25, row: 1, count: 4 },
          { col: 3, row: 3, count: 0 },
        ],
      },
      region: REGION,
      inRegion: 1,
    });
    expect(parsed).toEqual({
      count: 3,
      pins: [{ x: 0.1, y: 0.9 }],
      heat: { size: 20, cells: [{ col: 2, row: 18, count: 1 }] },
      region: REGION,
      inRegion: 1,
    });
    expect(parsePinDistribution({ kind: "pin_on_image" })).toMatchObject({ count: 0, pins: [], region: null, inRegion: null });
    expect(parsePinDistribution({ kind: "words" })).toBeNull();
  });

  test("editor: image, alt text, and a correct area while graded", () => {
    expect(def.validate(def.clean(def.blank()))).toBe("question text is missing.");
    expect(validateSlide(cleanSlide(withQuestion(def.blank())))).toBe("choose an image or paste an https link.");
    expect(validateSlide(cleanSlide(pin({ content: { key: null, url: "http://x.example/a.png", alt: "A" } })))).toBe(
      "image links must start with https://."
    );
    expect(validateSlide(cleanSlide(pin({ content: { key: null, url: "https://x.example/a.png", alt: "  " } })))).toBe(
      "add alt text describing the image."
    );
    expect(validateSlide(cleanSlide(pin({ config: { region: null } })))).toBe(
      "draw the correct area on the image, or turn grading off."
    );
    expect(validateSlide(cleanSlide(pin({ config: { region: { ...REGION, width: 0.001 } } })))).toBe(
      "the correct area is too small."
    );
    expect(validateSlide(cleanSlide(pin({ timeLimit: 0 })))).toBe("scored slides need a timer of at least 5 seconds.");
    expect(validateSlide(cleanSlide(PIN))).toBeNull();
    expect(validateSlide(cleanSlide(pin({ points: 0, config: { region: null } })))).toBeNull();
  });

  test("an ungraded slide drops the area; graded keeps it; clean is idempotent", () => {
    const ungraded = cleanSlide(pin({ points: 0, scoreDependsOnTime: true }));
    expect(ungraded).toMatchObject({ points: 0, scoreDependsOnTime: false, config: { region: null } });
    const graded = cleanSlide(
      pin({ content: { key: null, url: " https://img.example/map.png ", alt: " Map of France " } })
    );
    expect(graded).toMatchObject({
      points: 300,
      content: { key: null, url: "https://img.example/map.png", alt: "Map of France" },
      config: { region: REGION },
    });
    expect(def.clean(graded)).toEqual(graded);
    expect(toSavePayload("Deck", [{ ...graded, _id: "s1" }]).slides[0]).toEqual(graded);
  });

  test("drafts keep a placeholder image, fill the alt text and drop an unusable area", () => {
    const draft = normalizeSlideForDraft(
      pin({ content: { key: null, url: "http://insecure.example/a.png", alt: "" }, config: { region: { ...REGION, x: 0.95 } } })
    );
    expect(draft.content).toEqual({ key: null, url: null, alt: "Image" });
    expect(draft.config).toEqual({ region: null });
    const blank = normalizeSlideForDraft(blankSlide("pin_on_image"));
    expect(blank).toMatchObject({ question: "Untitled Question", content: { url: null, alt: "Image" } });
    expect(normalizeSlideForDraft(pin({ timeLimit: 0 })).timeLimit).toBe(30);
  });

  test("the editor shows the area controls only while graded", () => {
    const graded = editorHtml(PIN);
    expect(graded).toContain("Correct area");
    expect(graded).toContain("Left (%)");
    expect(graded).toContain('value="40"');
    expect(graded).toContain("Alt text");
    const ungraded = editorHtml({ ...PIN, points: 0 });
    expect(ungraded).not.toContain("Correct area");
    expect(ungraded).toContain("Results only");
    const noImage = editorHtml({ ...PIN, content: { key: null, url: null, alt: "" } });
    expect(noImage).toContain("Choose an image first");
  });

  test("participants see the image and cannot submit before dropping a pin", () => {
    const view = participant(PIN, { content: { url: "https://img.example/map.png", alt: "Map of France" } });
    expect(view).toContain('src="https://img.example/map.png"');
    expect(view).toContain('referrerPolicy="no-referrer"');
    expect(view).toContain("Map of France. Tap to drop your pin");
    expect(view).toContain('tabindex="0"');
    expect(view).toContain("Tap the image to drop your pin.");
    expect(view).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(<span[^>]*>)?Submit Pin/);
    expect(view).not.toContain('data-testid="pin"');
    // The correct area is never part of what participants receive.
    expect(view).not.toContain("0.4");
    expect(participant(PIN, { content: { url: "https://img.example/map.png", alt: "x" } }, "preview")).toContain(
      'tabindex="-1"'
    );
  });

  test("a slide without an image shows a placeholder instead of a board", () => {
    const view = participant(PIN, { content: { url: null, alt: "" } });
    expect(view).toContain("No image yet");
    expect(view).not.toContain("<img");
  });

  test("the stage shows pins live and the heatmap, area and tally only once revealed", () => {
    const dist = {
      kind: "pin_on_image",
      count: 2,
      pins: [
        { x: 0.1, y: 0.9 },
        { x: 0.5, y: 0.3 },
      ],
      heat: {
        size: 20,
        cells: [
          { col: 2, row: 18, count: 1 },
          { col: 10, row: 6, count: 1 },
        ],
      },
      region: REGION,
      inRegion: 1,
    };
    const live = stage(PIN, "live", dist);
    expect(live).toContain("2 pins");
    expect(live).toContain("left:10%;top:90%");
    expect(live).not.toContain("correct-area");
    expect(live).not.toContain("in the correct area");
    expect(live).not.toContain("bg-deck-danger");
    const revealed = stage(PIN, "reveal", dist);
    expect(revealed).toContain('data-testid="correct-area"');
    expect(revealed).toContain("left:40%;top:20%;width:20%;height:20%");
    expect(revealed).toContain("1 of 2 in the correct area (50%)");
    expect(revealed.match(/bg-deck-danger/g)).toHaveLength(2);
    expect(stage(PIN, "report", dist)).toContain("in the correct area");
  });

  test("an ungraded slide reveals no area", () => {
    const dist = { kind: "pin_on_image", count: 1, pins: [{ x: 0.5, y: 0.5 }], heat: { size: 20, cells: [] }, region: null, inRegion: null };
    const revealed = stage(pin({ points: 0, config: { region: null } }), "reveal", dist);
    expect(revealed).not.toContain("correct-area");
    expect(revealed).not.toContain("in the correct area");
  });

  test("the thumbnail is just the image; a missing one shows a placeholder", () => {
    const thumb = stage(PIN, "thumbnail", { kind: "pin_on_image", count: 8, pins: [{ x: 0.5, y: 0.5 }] });
    expect(thumb).toContain("<img");
    expect(thumb).not.toContain("left:50%");
    expect(thumb).not.toContain("correct-area");
    expect(stage(blankSlide("pin_on_image"), "thumbnail")).toContain("No image yet");
  });
});
