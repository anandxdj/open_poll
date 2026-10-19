import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  toDraftPayload,
  toSavePayload,
  validateDeck,
  withoutSlideId,
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
import { selectAnswerConfig } from "@/features/presentations/slides/types/select_answer/config";
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

/** The advanced interactive types; their editors, validation and views are tested in slides.advanced.test.tsx. */
const ADVANCED_TYPES = [
  "guess_number",
  "hundred_points",
  "grid_2x2",
  "pin_on_image",
] as const satisfies readonly PresentationSlideType[];

const ALL_TYPES: PresentationSlideType[] = [...QUESTION_TYPES, ...ADVANCED_TYPES, ...CONTENT_SLIDE_TYPES];

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

/** Mirrors the backend slide type schemas (`presentations/slides/types/*.ts`). */
function passesApiRules(s: PresentationSlide): boolean {
  if (!s.question) return false;
  if (s.type === "leaderboard") return true;
  if (s.type === "select_answer") {
    // A 0-point slide is ungraded and needs no correct option; the explanation is capped.
    if ((s.config?.explanation ?? "").length > 2000) return false;
    return s.options.length >= 2 && (s.points === 0 || s.options.some((o) => o.isCorrect));
  }
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

  test("picker offers the interactive, quiz, advanced and content types in order, never leaderboard", () => {
    expect(PICKER_SECTIONS.map((s) => s.id)).toEqual(["interactive", "competition", "advanced", "content"]);
    expect(slideMetaInSection("interactive").map((m) => m.type)).toEqual([
      "wordcloud",
      "open_ended",
      "scales",
      "ranking",
    ]);
    expect(slideMetaInSection("competition").map((m) => m.type)).toEqual(["select_answer", "type_answer"]);
    expect(slideMetaInSection("advanced").map((m) => m.type)).toEqual([...ADVANCED_TYPES]);
    expect(slideMetaInSection("content").map((m) => m.type)).toEqual([...CONTENT_SLIDE_TYPES]);
    expect(SLIDE_TYPE_META.map((m) => m.type)).not.toContain("leaderboard");
    expect(SLIDE_TYPE_META).toHaveLength(18);
  });

  test("the AI draft offers only the six types the generate endpoint accepts, in the original order (never the advanced types)", () => {
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
    // The advanced types start ungraded (scored: they can award points once a correct answer is set).
    for (const type of ALL_TYPES.filter((t) => !(ADVANCED_TYPES as readonly string[]).includes(t))) {
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

describe("select_answer settings: graded, multi-select, explanation", () => {
  const def = SLIDE_EDITORS.select_answer;
  const options = (...correct: boolean[]) =>
    correct.map((isCorrect, i) => ({ text: ["Mars", "Venus", "Earth", "Jupiter"][i], isCorrect }));
  const slide = (patch: Partial<PresentationSlide>): PresentationSlide => ({
    ...blankSlide("select_answer"),
    question: "Pick",
    ...patch,
  });
  const renderEditor = (s: PresentationSlide) =>
    renderToStaticMarkup(createElement(def.Editor, { slide: s, onChange: () => {} }));
  const switchesOn = (html: string) => html.match(/role="switch"[^>]*aria-checked="true"/g)?.length ?? 0;

  test("blank() is a graded single-select slide with default settings", () => {
    expect(blankSlide("select_answer")).toMatchObject({ points: 1000, config: null });
    expect(selectAnswerConfig(blankSlide("select_answer"))).toEqual({ allowMultiple: false, explanation: "" });
  });

  test("selectAnswerConfig fills defaults for slides saved before the settings", () => {
    expect(selectAnswerConfig({})).toEqual({ allowMultiple: false, explanation: "" });
    expect(selectAnswerConfig({ config: null })).toEqual({ allowMultiple: false, explanation: "" });
    expect(selectAnswerConfig({ config: { allowMultiple: true } })).toEqual({ allowMultiple: true, explanation: "" });
    expect(selectAnswerConfig({ config: { explanation: "Why" } })).toEqual({ allowMultiple: false, explanation: "Why" });
  });

  test("an existing single-select graded slide round-trips unchanged", () => {
    const saved = slide({ _id: "s1", options: options(true, false, false), config: null });
    expect(cleanSlide(saved)).toEqual(saved);
    expect(validateSlide(saved)).toBeNull();
    expect(toSavePayload("Deck", [saved]).slides[0]).toEqual(withoutSlideId(saved));
    expect(normalizeSlideForDraft(saved)).toEqual(saved);
    // Several correct options still mean "any of them" on a single-select slide.
    const anyOf = slide({ options: options(true, true, false), config: null });
    expect(cleanSlide(anyOf)).toEqual(anyOf);
  });

  test("settings at their defaults are saved as null", () => {
    const blankExplanation = slide({
      options: options(true, false),
      config: { allowMultiple: false, explanation: "   " },
    });
    expect(cleanSlide(blankExplanation).config).toBeNull();
    expect(cleanSlide(slide({ options: options(true, false), config: undefined })).config).toBeNull();
  });

  test("graded slides need a correct option; ungraded ones do not", () => {
    expect(validateSlide(cleanSlide(slide({ options: options(false, false) })))).toBe("mark a correct option.");
    const ungraded = cleanSlide(slide({ points: 0, options: options(false, false) }));
    expect(validateSlide(ungraded)).toBeNull();
    expect(passesApiRules(ungraded)).toBe(true);
  });

  test("an ungraded slide drops its correct marks on save", () => {
    const cleaned = cleanSlide(slide({ points: 0, options: options(true, false) }));
    expect(cleaned.options).toEqual(options(false, false));
    expect(def.clean(cleaned)).toEqual(cleaned);
  });

  test("graded multi-select keeps every correct option and its settings", () => {
    const filled = slide({
      options: options(true, false, true),
      config: { allowMultiple: true, explanation: "  Both are planets.  " },
    });
    const cleaned = cleanSlide(filled);
    expect(cleaned.options).toEqual(options(true, false, true));
    expect(cleaned.config).toEqual({ allowMultiple: true, explanation: "Both are planets." });
    expect(validateSlide(cleaned)).toBeNull();
    expect(def.clean(cleaned)).toEqual(cleaned);
    expect(passesApiRules(cleaned)).toBe(true);
    expect(validateSlide(cleanSlide({ ...filled, options: options(false, false, false) }))).toBe(
      "mark a correct option."
    );
  });

  test("a converted poll (ungraded multi-select with an explanation) saves as is", () => {
    const converted = slide({
      _id: "c1",
      points: 0,
      scoreDependsOnTime: false,
      options: options(false, false, false),
      config: { allowMultiple: true, explanation: "From the poll" },
    });
    expect(cleanSlide(converted)).toEqual(converted);
    expect(validateSlide(converted)).toBeNull();
    expect(validateDeck("Converted", [converted])).toBeNull();
    expect(normalizeSlideForDraft(converted)).toEqual(converted);
    expect(passesApiRules(converted)).toBe(true);
  });

  test("draft normalization marks a correct option only on graded slides", () => {
    expect(normalizeSlideForDraft(slide({ options: [] })).options).toEqual([
      { text: "Option 1", isCorrect: true },
      { text: "Option 2", isCorrect: false },
    ]);
    const ungraded = normalizeSlideForDraft(slide({ points: 0, options: [] }));
    expect(ungraded.options).toEqual([
      { text: "Option 1", isCorrect: false },
      { text: "Option 2", isCorrect: false },
    ]);
    expect(passesApiRules(ungraded)).toBe(true);
  });

  test("the explanation is capped at the API limit", () => {
    const long = slide({
      options: options(true, false),
      config: { allowMultiple: false, explanation: "x".repeat(2001) },
    });
    expect(validateSlide(cleanSlide(long))).toBe("keep the explanation under 2000 characters.");
    const draft = normalizeSlideForDraft(long);
    expect(draft.config?.explanation).toHaveLength(2000);
    expect(passesApiRules(draft)).toBe(true);
  });

  test("the editor shows the graded and multi-select controls", () => {
    const single = renderEditor(slide({ options: options(true, false) }));
    expect(single).toContain("Graded");
    expect(single).toContain("Allow multiple answers");
    expect(single).toContain("Explanation (optional)");
    expect(single).toContain("tap the circle to mark correct");
    expect(single.match(/aria-label="Mark option \d correct"/g)).toHaveLength(2);
    expect(switchesOn(single)).toBe(1);

    const multi = renderEditor(
      slide({ options: options(true, true), config: { allowMultiple: true, explanation: "" } })
    );
    expect(multi).toContain("tick every correct option");
    expect(multi.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(switchesOn(multi)).toBe(2);

    const ungraded = renderEditor(slide({ points: 0, options: options(false, false) }));
    expect(ungraded).not.toContain("Mark option");
    expect(ungraded).toContain("Results only");
    expect(switchesOn(ungraded)).toBe(0);
  });
});
