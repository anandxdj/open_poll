import { describe, expect, test } from "bun:test";

import {
  toDraftPayload,
  toSavePayload,
  validateDeck,
} from "@/features/presentations/components/builder/deckDraft";
import {
  blankSlide,
  cleanSlide,
  normalizeSlideForDraft,
  SLIDE_EDITORS,
  validateSlide,
} from "@/features/presentations/slides/editor";
import {
  AI_SLIDE_TYPE_META,
  PICKER_SECTIONS,
  SLIDE_META,
  SLIDE_TYPE_META,
  slideMetaInSection,
} from "@/features/presentations/slides/meta";
import { CONTENT_SLIDE_TYPES } from "@/features/presentations/types/content";
import {
  isScoredSlideType,
  type PresentationSlide,
  type PresentationSlideType,
} from "@/features/presentations/types/deck";

/** The types with a question (content types are covered by slides.content.test.tsx). */
const QUESTION_TYPES = [
  "select_answer",
  "type_answer",
  "wordcloud",
  "open_ended",
  "scales",
  "ranking",
  "leaderboard",
] as const satisfies readonly PresentationSlideType[];

type QuestionType = (typeof QUESTION_TYPES)[number];

const ALL_TYPES: PresentationSlideType[] = [...QUESTION_TYPES, ...CONTENT_SLIDE_TYPES];

/** Smallest edit that makes a blank slide of each type saveable. */
const FILL: Record<QuestionType, (s: PresentationSlide) => PresentationSlide> = {
  select_answer: (s) => ({
    ...s,
    options: [
      { text: "Paris", isCorrect: true },
      { text: "Rome", isCorrect: false },
    ],
  }),
  type_answer: (s) => ({ ...s, acceptedAnswers: ["Paris"] }),
  wordcloud: (s) => s,
  open_ended: (s) => s,
  scales: (s) => ({ ...s, statements: ["Coffee is great"] }),
  ranking: (s) => ({ ...s, items: ["Alpha", "Beta"] }),
  leaderboard: (s) => s,
};

/** Mirrors the backend Zod superRefine in presentations.schema.ts. */
function passesApiRules(s: PresentationSlide): boolean {
  if (!s.question) return false;
  if (s.type === "leaderboard") return true;
  if (s.type === "select_answer") return s.options.length >= 2 && s.options.some((o) => o.isCorrect);
  if (s.type === "type_answer") return s.acceptedAnswers.length >= 1;
  if (s.type === "scales") return s.statements.length >= 1;
  if (s.type === "ranking") return s.items.length >= 2;
  return true;
}

describe("slide meta registry", () => {
  test("covers every slide type, keyed by its own type", () => {
    expect(Object.keys(SLIDE_META).sort()).toEqual([...ALL_TYPES].sort());
    for (const type of ALL_TYPES) expect(SLIDE_META[type].type).toBe(type);
  });

  test("registry entries are listed alphabetically (append-only file)", () => {
    const types = Object.keys(SLIDE_META);
    expect(types).toEqual([...types].sort());
  });

  test("scored flag matches isScoredSlideType", () => {
    for (const type of ALL_TYPES) expect(SLIDE_META[type].scored).toBe(isScoredSlideType(type));
  });

  test("picker offers the interactive, quiz and content types in order, never leaderboard", () => {
    expect(PICKER_SECTIONS.map((s) => s.id)).toEqual(["interactive", "competition", "content"]);
    expect(slideMetaInSection("interactive").map((m) => m.type)).toEqual([
      "wordcloud",
      "open_ended",
      "scales",
      "ranking",
    ]);
    expect(slideMetaInSection("competition").map((m) => m.type)).toEqual(["select_answer", "type_answer"]);
    expect(slideMetaInSection("content").map((m) => m.type)).toEqual([...CONTENT_SLIDE_TYPES]);
    expect(SLIDE_TYPE_META.map((m) => m.type)).not.toContain("leaderboard");
    expect(SLIDE_TYPE_META).toHaveLength(14);
  });

  test("the AI draft offers only the six types the generate endpoint accepts, in the original order", () => {
    expect(AI_SLIDE_TYPE_META.map((m) => m.type)).toEqual([
      "select_answer",
      "type_answer",
      "wordcloud",
      "open_ended",
      "scales",
      "ranking",
    ]);
  });
});

describe("slide editor registry", () => {
  test("covers every slide type and shares the meta registry", () => {
    expect(Object.keys(SLIDE_EDITORS).sort()).toEqual([...ALL_TYPES].sort());
    for (const type of ALL_TYPES) {
      const def = SLIDE_EDITORS[type];
      expect(def.meta).toBe(SLIDE_META[type]);
      expect(typeof def.Editor).toBe("function");
    }
  });

  test("blank() matches the builder's original defaults", () => {
    expect(blankSlide()).toEqual(blankSlide("select_answer"));
    expect(blankSlide("select_answer").options).toEqual([
      { text: "", isCorrect: true },
      { text: "", isCorrect: false },
    ]);
    expect(blankSlide("scales")).toMatchObject({ statements: [""], minLabel: "Disagree", maxLabel: "Agree" });
    expect(blankSlide("ranking").items).toEqual(["", ""]);
    expect(blankSlide("open_ended").timeLimit).toBe(60);
    expect(blankSlide("wordcloud")).toMatchObject({ timeLimit: 30, maxEntries: 3, scaleMax: 5 });
    for (const type of ALL_TYPES) {
      const scored = isScoredSlideType(type);
      expect(blankSlide(type)).toMatchObject({
        type,
        question: "",
        acceptedAnswers: [],
        points: scored ? 1000 : 0,
        scoreDependsOnTime: scored,
      });
    }
  });

  test("blank() returns a fresh object each call", () => {
    const a = blankSlide("select_answer");
    a.options[0].text = "mutated";
    expect(blankSlide("select_answer").options[0].text).toBe("");
  });

  for (const type of QUESTION_TYPES) {
    test(`${type}: blank → validate → clean round trip`, () => {
      const def = SLIDE_EDITORS[type];
      const blank = def.blank();

      // A blank slide is never saveable: the question is missing first.
      expect(def.validate(def.clean(blank))).toBe("question text is missing.");

      const filled = FILL[type]({ ...blank, question: "  Capital of France?  " });
      const cleaned = def.clean(filled);
      expect(def.validate(cleaned)).toBeNull();
      expect(cleaned.question).toBe("Capital of France?");
      expect(def.clean(cleaned)).toEqual(cleaned);
      expect(passesApiRules(cleaned)).toBe(true);

      // Registry helpers dispatch to the same definition.
      expect(cleanSlide(filled)).toEqual(cleaned);
      expect(validateSlide(cleaned)).toBeNull();
    });

    test(`${type}: a blank slide normalized for a draft passes the API rules`, () => {
      const normalized = normalizeSlideForDraft(blankSlide(type));
      expect(normalized.question).toBe("Untitled Question");
      expect(passesApiRules(normalized)).toBe(true);
    });
  }

  for (const type of ALL_TYPES) {
    test(`${type}: clean drops fields that belong to other types`, () => {
      const polluted: PresentationSlide = {
        ...SLIDE_EDITORS[type].blank(),
        question: "Q",
        options: [{ text: "x", isCorrect: true }],
        acceptedAnswers: ["x"],
        statements: ["x"],
        minLabel: "lo",
        maxLabel: "hi",
        items: ["x"],
        points: 500,
        scoreDependsOnTime: true,
      };
      const cleaned = cleanSlide(polluted);
      expect(cleaned.options.length > 0).toBe(type === "select_answer");
      expect(cleaned.acceptedAnswers.length > 0).toBe(type === "type_answer");
      expect(cleaned.statements.length > 0).toBe(type === "scales");
      expect(cleaned.minLabel !== "").toBe(type === "scales");
      expect(cleaned.items.length > 0).toBe(type === "ranking");
      expect(cleaned.points).toBe(isScoredSlideType(type) ? 500 : 0);
      expect(cleaned.scoreDependsOnTime).toBe(isScoredSlideType(type));
    });
  }

  test("type-specific validation messages", () => {
    const base = (type: PresentationSlideType) => ({ ...blankSlide(type), question: "Q" });
    expect(validateSlide(cleanSlide({ ...base("select_answer"), options: [{ text: "A", isCorrect: true }] }))).toBe(
      "needs at least 2 options."
    );
    expect(
      validateSlide(
        cleanSlide({
          ...base("select_answer"),
          options: [
            { text: "A", isCorrect: false },
            { text: "B", isCorrect: false },
            { text: "", isCorrect: true },
          ],
        })
      )
    ).toBe("mark a correct option.");
    expect(validateSlide(base("type_answer"))).toBe("add at least one accepted answer.");
    expect(validateSlide(cleanSlide({ ...base("scales"), statements: ["  "] }))).toBe("add at least one statement.");
    expect(validateSlide(cleanSlide({ ...base("ranking"), items: ["A", " "] }))).toBe("ranking needs at least 2 items.");
  });

  test("draft normalization fills gaps per type", () => {
    const select = normalizeSlideForDraft({
      ...blankSlide("select_answer"),
      options: [{ text: " Only ", isCorrect: false }],
    });
    expect(select.options).toEqual([
      { text: "Only", isCorrect: true },
      { text: "Option 2", isCorrect: false },
    ]);
    expect(normalizeSlideForDraft(blankSlide("type_answer")).acceptedAnswers).toEqual(["Untitled Question"]);
    expect(normalizeSlideForDraft({ ...blankSlide("type_answer"), question: "Q" }).acceptedAnswers).toEqual(["Q"]);
    expect(normalizeSlideForDraft(blankSlide("scales")).statements).toEqual(["Untitled statement"]);
    expect(normalizeSlideForDraft(blankSlide("ranking")).items).toEqual(["Item 1", "Item 2"]);
  });
});

describe("deck validation and payloads", () => {
  test("title first, then the first failing slide with its position", () => {
    const ok = { ...FILL.ranking(blankSlide("ranking")), question: "Q" };
    expect(validateDeck("  ", [ok])).toBe("Give your presentation deck a title.");
    expect(validateDeck("Deck", [ok, blankSlide("wordcloud")])).toBe("Slide 2: question text is missing.");
    expect(validateDeck("Deck", [ok, blankSlide("heading")])).toBe("Slide 2: add a title.");
    expect(validateDeck("Deck", [ok])).toBeNull();
  });

  test("payloads strip slide ids and trim the title", () => {
    const slide = { ...FILL.wordcloud(blankSlide("wordcloud")), question: "Q", _id: "abc" };
    const save = toSavePayload("  Deck  ", [slide]);
    expect(save.title).toBe("Deck");
    expect("_id" in save.slides[0]).toBe(false);

    const draft = toDraftPayload("", [slide]);
    expect(draft.title).toBe("Untitled Presentation Deck");
    expect("_id" in draft.slides[0]).toBe(false);
  });
});
