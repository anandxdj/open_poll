import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { StageView } from "@/features/presentations/components/stage/StageView";
import { blankSlide } from "@/features/presentations/slides/editor";
import { SLIDE_META } from "@/features/presentations/slides/meta";
import { getSlideRuntime, runtimeSlideTypes } from "@/features/presentations/slides/runtime";
import type { LiveSlide, PresentationSlide, PresentationSlideType } from "@/features/presentations/types";

const metaTypes = () => Object.keys(SLIDE_META) as PresentationSlideType[];

const toLiveSlide = (slide: PresentationSlide): LiveSlide => ({
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
});

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

  test("lifecycles: answerable types are `response`, leaderboard is `system`", () => {
    for (const type of metaTypes()) {
      expect(getSlideRuntime(type)?.lifecycle).toBe(type === "leaderboard" ? "system" : "response");
    }
  });

  test("unknown types have no runtime", () => {
    expect(getSlideRuntime("heading")).toBeUndefined();
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

  test("a stage view with no matching data renders nothing", () => {
    const html = renderToStaticMarkup(<StageView slide={sample("scales")} mode="live" />);
    expect(html).toBe("");
  });
});
