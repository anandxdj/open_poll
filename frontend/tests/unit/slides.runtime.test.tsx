import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { StageView } from "@/features/presentations/components/stage/StageView";
import { blankSlide } from "@/features/presentations/slides/editor";
import { SLIDE_META } from "@/features/presentations/slides/meta";
import { getSlideRuntime, runtimeSlideTypes } from "@/features/presentations/slides/runtime";
import { isGradedSlide } from "@/features/presentations/slides/shared";
import { SelectAnswerParticipant } from "@/features/presentations/slides/types/select_answer/participant";
import type { LiveSlide, PresentationSlide, PresentationSlideType } from "@/features/presentations/types";
import { isContentSlideType } from "@/features/presentations/types/content";

const metaTypes = () => Object.keys(SLIDE_META) as PresentationSlideType[];

/** The participant payload of `slide` (content slides carry their `content`). */
const toLiveSlide = (slide: PresentationSlide): LiveSlide =>
  Object.assign(
    {
      slideIndex: 0,
      totalSlides: 1,
      type: slide.type,
      scored: slide.type === "select_answer" || slide.type === "type_answer",
      question: slide.question,
      options: slide.options.map((o) => ({ text: o.text })),
      statements: slide.statements,
      minLabel: slide.minLabel,
      maxLabel: slide.maxLabel,
      scaleMax: slide.scaleMax,
      items: slide.items,
      maxEntries: slide.maxEntries,
      timeLimit: slide.timeLimit,
      points: slide.points,
      scoreDependsOnTime: slide.scoreDependsOnTime,
    },
    slide.content ? { content: slide.content } : {}
  );

/** A blank slide with enough content for every view to have something to draw. */
const sample = (type: PresentationSlideType): PresentationSlide => ({
  ...blankSlide(type),
  question: `Sample ${type}`,
  options: [
    { text: "Mars", isCorrect: true },
    { text: "Venus", isCorrect: false },
  ],
  acceptedAnswers: ["Paris"],
  statements: ["Pace"],
  items: ["One", "Two"],
});

describe("slide runtime registry", () => {
  test("every slide type the builder offers has a runtime, and nothing else does", () => {
    expect([...runtimeSlideTypes()].sort()).toEqual([...metaTypes()].sort());
  });

  test("registry entries are listed alphabetically (append-only file)", () => {
    const types = runtimeSlideTypes();
    expect(types).toEqual([...types].sort());
  });

  test("lifecycles: answerable types are `response`, leaderboard is `system`, content types are `content`", () => {
    for (const type of metaTypes()) {
      const expected = type === "leaderboard" ? "system" : isContentSlideType(type) ? "content" : "response";
      expect(getSlideRuntime(type)?.lifecycle).toBe(expected);
    }
  });

  test("unknown types have no runtime", () => {
    expect(getSlideRuntime("qna")).toBeUndefined();
  });

  for (const type of metaTypes()) {
    test(`${type}: StageView thumbnail and ParticipantView preview render outside a live session`, () => {
      const runtime = getSlideRuntime(type)!;
      const slide = sample(type);
      const html = renderToStaticMarkup(
        <LiveIntlProvider>
          <StageView slide={slide} mode="thumbnail" />
          <runtime.ParticipantView slide={toLiveSlide(slide)} mode="preview" onSubmit={() => {}} submitting={false} />
        </LiveIntlProvider>
      );
      expect(html.length).toBeGreaterThan(0);
      // Preview forms are inert.
      expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*type="submit"/);
    });
  }

  test("select_answer stage highlights the correct option only in reveal/report modes", () => {
    const slide = sample("select_answer");
    const live = {
      distribution: { kind: "options" as const, counts: [2, 1], options: slide.options },
      answeredCount: 3,
      leaderboard: [],
    };
    const render = (mode: "live" | "reveal" | "report") =>
      renderToStaticMarkup(<StageView slide={slide} mode={mode} live={live} />);
    expect(render("live")).not.toContain("bg-deck-correct ");
    expect(render("reveal")).toContain("bg-deck-correct ");
    expect(render("report")).toContain("bg-deck-correct ");
    expect(render("live")).toContain("67%");
  });

  describe("select_answer: multi-select, ungraded, explanation", () => {
    const planets = (...correct: boolean[]) =>
      correct.map((isCorrect, i) => ({ text: ["Mars", "Venus", "Earth"][i], isCorrect }));
    const deckSlide = (patch: Partial<PresentationSlide>): PresentationSlide => ({
      ...sample("select_answer"),
      options: planets(true, false, true),
      ...patch,
    });
    const liveData = (s: PresentationSlide, counts: number[], answeredCount: number) => ({
      distribution: { kind: "options" as const, counts, options: s.options },
      answeredCount,
      leaderboard: [],
    });
    const stage = (s: PresentationSlide, mode: "live" | "reveal" | "report", counts = [2, 1, 1], answered = 2) =>
      renderToStaticMarkup(<StageView slide={s} mode={mode} live={liveData(s, counts, answered)} />);
    const highlighted = (html: string) => html.match(/bg-deck-correct /g)?.length ?? 0;
    const participant = (s: PresentationSlide, allowMultiple?: boolean) =>
      renderToStaticMarkup(
        <LiveIntlProvider>
          <SelectAnswerParticipant
            slide={{ ...toLiveSlide(s), ...(allowMultiple ? { allowMultiple } : {}) }}
            mode="preview"
            onSubmit={() => {}}
            submitting={false}
          />
        </LiveIntlProvider>
      );

    test("participants get checkboxes only on multi-select slides", () => {
      const s = deckSlide({});
      const multi = participant(s, true);
      expect(multi.match(/role="checkbox"/g)).toHaveLength(3);
      expect(multi).toContain('aria-checked="false"');
      expect(multi).toContain("Select all that apply");
      expect(multi).toContain("Submit Answer");
      const single = participant(s);
      expect(single).not.toContain('role="checkbox"');
      expect(single).not.toContain("Select all that apply");
    });

    test("a graded multi-select reveal highlights every correct option", () => {
      const s = deckSlide({ config: { allowMultiple: true, explanation: "" } });
      expect(highlighted(stage(s, "live"))).toBe(0);
      expect(highlighted(stage(s, "reveal"))).toBe(2);
      expect(highlighted(stage(s, "report"))).toBe(2);
      expect(stage(s, "live")).toContain("Multiple answers allowed");
    });

    test("multi-select shares are of respondents, not of picks", () => {
      const s = deckSlide({ config: { allowMultiple: true, explanation: "" } });
      const html = stage(s, "live", [2, 1, 0], 2);
      expect(html).toContain("100%");
      expect(html).toContain("50%");
      // Single-select keeps shares of all votes.
      expect(stage(deckSlide({}), "live", [2, 1, 1], 4)).toContain("25%");
    });

    test("an ungraded slide reveals its results without marking or dimming any option", () => {
      const s = deckSlide({ points: 0, options: planets(false, false, false) });
      const revealed = stage(s, "reveal");
      expect(highlighted(revealed)).toBe(0);
      expect(revealed).not.toContain("opacity-40");
      expect(revealed).toContain("Mars");
      expect(revealed).toContain("50%");
      // Even stale correct marks stay hidden on a 0-point slide.
      expect(highlighted(stage(deckSlide({ points: 0 }), "reveal"))).toBe(0);
    });

    test("the explanation appears after the reveal only", () => {
      const s = deckSlide({ config: { allowMultiple: false, explanation: "Mars is red; Earth is home." } });
      expect(stage(s, "live")).not.toContain("Mars is red");
      expect(stage(s, "reveal")).toContain("Mars is red; Earth is home.");
      expect(stage(s, "report")).toContain("Explanation");
      expect(renderToStaticMarkup(<StageView slide={s} mode="thumbnail" />)).not.toContain("Mars is red");
      expect(stage(deckSlide({}), "reveal")).not.toContain("Explanation");
    });

    test("isGradedSlide: a 0-point select answer is ungraded, other scored slides are not", () => {
      expect(isGradedSlide({ type: "select_answer", scored: true, points: 1000 })).toBe(true);
      expect(isGradedSlide({ type: "select_answer", scored: true, points: 0 })).toBe(false);
      expect(isGradedSlide({ type: "type_answer", scored: true, points: 0 })).toBe(true);
      expect(isGradedSlide({ type: "wordcloud", scored: false, points: 0 })).toBe(false);
    });
  });

  test("a stage view with no matching data renders nothing", () => {
    const html = renderToStaticMarkup(<StageView slide={sample("scales")} mode="live" />);
    expect(html).toBe("");
  });
});
