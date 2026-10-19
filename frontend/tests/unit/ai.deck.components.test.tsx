import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AiDeckError } from "@/features/ai/deck/AiDeckError";
import { AiDeckForm } from "@/features/ai/deck/AiDeckForm";
import { AiDeckOutline } from "@/features/ai/deck/AiDeckOutline";
import { AiDeckPlanning, AiDeckWriting } from "@/features/ai/deck/AiDeckProgress";
import { AiDeckResult, countSlidesWithNotes } from "@/features/ai/deck/AiDeckResult";
import { AiIntlProvider } from "@/features/ai/deck/AiIntlProvider";
import { MockDataNotice } from "@/features/ai/deck/AiSourceNotice";
import { defaultForm } from "@/features/ai/deck/form";
import type { DeckCreatedResponse, DeckKindInfo, DeckOutline } from "@/features/ai/deck/types";
import { blankSlide } from "@/features/presentations/slides/editor";
import type { PresentationSlide } from "@/features/presentations/types/deck";

const render = (element: ReactElement) => renderToStaticMarkup(createElement(AiIntlProvider, null, element));
const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const kinds: DeckKindInfo[] = [
  { kind: "heading", type: "heading", category: "content" },
  { kind: "bullets", type: "bullets", category: "content" },
  { kind: "multiple_choice_quiz", type: "select_answer", category: "quiz" },
];

const outline: DeckOutline = {
  title: "Zero trust 101",
  sections: [
    { title: "Basics", slides: [{ type: "heading", intent: "Introduce zero trust" }, { type: "bullets", intent: "List the pillars" }] },
    { title: "Check", slides: [{ type: "multiple_choice_quiz", intent: "Test recall" }] },
  ],
};

describe("AiDeckForm", () => {
  const form = (aiAvailable: boolean | null = true, error = null) =>
    render(
      createElement(AiDeckForm, {
        form: defaultForm("Zero trust"),
        onChange: noop,
        onSubmit: noop,
        onCancel: noop,
        error,
        aiAvailable,
      }),
    );

  test("has every input of the request", () => {
    const html = form();
    for (const label of ["Topic", "Audience (optional)", "Language", "Slides", "Tone", "Include", "Source material (optional)"]) {
      expect(html).toContain(label);
    }
    for (const tone of ["Professional", "Casual", "Educational", "Inspiring", "Funny"]) expect(html).toContain(tone);
    for (const include of ["Content slides", "Polls", "Quiz questions"]) expect(html).toContain(include);
    expect(html).toContain('min="3"');
    expect(html).toContain('max="30"');
    expect(html).toContain("Plan outline");
    // The source text field is collapsed until asked for.
    expect(html).not.toContain("never followed as instructions");
  });

  test("says up front that the server will use mock mode", () => {
    expect(form(false)).toContain('data-testid="ai-deck-mock-capability"');
    expect(text(form(false))).toContain("No AI key is configured on this server");
    expect(form(true)).not.toContain("ai-deck-mock-capability");
    expect(form(null)).not.toContain("ai-deck-mock-capability");
  });

  test("shows a request error", () => {
    const html = form(true, { kind: "rate" } as never);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("Too many AI requests");
  });
});

describe("AiDeckOutline", () => {
  const view = (extra: Partial<Parameters<typeof AiDeckOutline>[0]> = {}) =>
    render(
      createElement(AiDeckOutline, {
        outline,
        kinds,
        include: { content: true, polls: true, quiz: true },
        source: "llm",
        warnings: [],
        error: null,
        onChange: noop,
        onBack: noop,
        onSubmit: noop,
        ...extra,
      }),
    );

  test("lists every slide of every section with editable type and intent", () => {
    const html = view();
    expect(html).toContain('value="Zero trust 101"');
    expect(html).toContain('value="Basics"');
    expect(html).toContain('value="Check"');
    for (const intent of ["Introduce zero trust", "List the pillars", "Test recall"]) expect(html).toContain(`value="${intent}"`);
    for (const label of ["Type of slide 1", "Type of slide 3", "What slide 2 covers", "Move slide 2 down", "Remove slide 3", "Title of section 2"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("Quiz: multiple choice");
    expect(text(html)).toContain("3 slides");
    expect(text(html)).toContain("Write slides and speaker notes");
    // The first slide cannot move up, the last cannot move down.
    expect(html).toMatch(/aria-label="Move slide 1 up"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Move slide 3 down"[^>]*disabled/);
    expect(html).toContain('<option value="multiple_choice_quiz" selected="">');
  });

  test("labels a mock outline", () => {
    expect(view({ source: "mock" })).toContain('data-testid="ai-deck-mock-notice"');
    expect(view({ source: "llm" })).not.toContain("ai-deck-mock-notice");
  });

  test("shows warnings and request errors", () => {
    const html = view({
      warnings: [{ code: "OUTLINE_SHORT", message: "The outline has 3 slides instead of 5." }],
      error: { kind: "limit", max: 5 },
    });
    expect(html).toContain("The outline has 3 slides instead of 5.");
    expect(text(html)).toContain("You have used all 5 AI decks");
  });

  test("a kind this client has no label for still shows", () => {
    const html = view({ outline: { ...outline, sections: [{ title: "S", slides: [{ type: "pin_on_image", intent: "Pin it" }] }] }, kinds: [] });
    expect(html).toContain("Pin on image");
  });
});

const slide = (fields: Partial<PresentationSlide> & { notes?: string }): PresentationSlide => ({ ...blankSlide("select_answer"), ...fields }) as PresentationSlide;

const result = (source: "llm" | "mock", extra: Partial<DeckCreatedResponse> = {}): DeckCreatedResponse => ({
  step: "deck",
  presentation: {
    _id: "deck1",
    title: "Zero trust 101",
    slides: [
      slide({ type: "heading", question: "", content: { title: "Zero trust 101", subtitle: "" }, notes: "Welcome everyone." } as never),
      slide({ question: "What is the first principle?", notes: "" } as never),
    ],
  } as never,
  outline,
  warnings: [],
  source,
  usage: null,
  ...extra,
});

describe("AiDeckResult", () => {
  const view = (response: DeckCreatedResponse) =>
    render(createElement(AiDeckResult, { result: response, onOpen: noop, onAnother: noop }));

  test("mock decks carry the mock notice", () => {
    const html = view(result("mock"));
    expect(html).toContain('data-testid="ai-deck-mock-notice"');
    expect(text(html)).toContain("Generated with mock data (no AI key configured)");
    expect(html).not.toContain("Generated by AI");
  });

  test("AI decks say so and do not claim mock data", () => {
    const html = view(result("llm"));
    expect(text(html)).toContain("Generated by AI. Check the facts before you present.");
    expect(html).not.toContain("ai-deck-mock-notice");
  });

  test("lists the slides with their speaker notes and counts them", () => {
    const html = view(result("llm"));
    expect(text(html)).toContain("2 slides, 1 with speaker notes");
    expect(text(html)).toContain("Notes: Welcome everyone.");
    expect(text(html)).toContain("No speaker notes");
    expect(text(html)).toContain("What is the first principle?");
    expect(text(html)).toContain("Open in builder");
    expect(text(html)).toContain("Generate another");
  });

  test("shows warnings and the plan usage", () => {
    const html = view(
      result("llm", {
        warnings: [{ code: "SLIDE_DROPPED", message: "Slide 4 was left out: options: Mark at least one option as correct.", position: 4 }],
        usage: { counter: "ai_deck", period: "202610", used: 2, limit: 5, remaining: 3 },
      }),
    );
    expect(text(html)).toContain("1 thing to check");
    expect(text(html)).toContain("Slide 4 was left out");
    expect(text(html)).toContain("2 of 5 AI decks used this month");
    expect(text(view(result("llm", { usage: { counter: "ai_deck", period: "202610", used: 7, limit: null, remaining: null } })))).toContain(
      "7 AI decks used this month",
    );
  });

  test("counts slides with notes", () => {
    expect(countSlidesWithNotes([slide({ notes: "x" } as never), slide({ notes: "  " } as never), slide({})])).toBe(1);
  });
});

describe("notices and progress", () => {
  test("the mock notice names the missing key and offers a dismiss button in the builder banner", () => {
    const html = render(createElement(MockDataNotice, { onDismiss: noop }));
    expect(text(html)).toContain("Generated with mock data (no AI key configured)");
    expect(text(html)).toContain("placeholders");
    expect(html).toContain('aria-label="Dismiss this notice"');
    expect(render(createElement(MockDataNotice, { compact: true }))).not.toContain("placeholders");
  });

  test("planning can be cancelled; writing says how many slides and cannot be", () => {
    const planning = render(createElement(AiDeckPlanning, { onCancel: noop }));
    expect(planning).toContain('role="status"');
    expect(text(planning)).toContain("Planning the outline");
    expect(text(planning)).toContain("Cancel");
    const writing = render(createElement(AiDeckWriting, { slideCount: 12 }));
    expect(text(writing)).toContain("Writing 12 slides with speaker notes");
    expect(text(writing)).not.toContain("Cancel");
    expect(text(render(createElement(AiDeckWriting, { slideCount: 1 })))).toContain("Writing 1 slide with");
  });

  test("every error kind has its own text", () => {
    const kindsOfError = ["limit", "rate", "provider", "empty", "forbidden", "invalid", "network", "unknown"] as const;
    const texts = kindsOfError.map((kind) => text(render(createElement(AiDeckError, { error: { kind, message: "bad topic" } }))));
    expect(new Set(texts).size).toBe(kindsOfError.length);
    expect(texts[5]).toContain("bad topic");
    expect(text(render(createElement(AiDeckError, { error: { kind: "limit" } })))).toContain("monthly limit");
  });
});
