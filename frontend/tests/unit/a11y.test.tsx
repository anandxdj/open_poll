import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveAnnouncer } from "@/components/a11y/live-announcer";
import { crossedMilestone, Timer, TIMER_MILESTONES } from "@/features/presentations/components/stage/Timer";
import { stageScrollProps } from "@/features/presentations/slides/shared";
import { RankingParticipant } from "@/features/presentations/slides/types/ranking/participant";
import { SelectAnswerParticipant } from "@/features/presentations/slides/types/select_answer/participant";
import type { LiveSlide } from "@/features/presentations/types";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { enMessages } from "@/i18n/messages";

/** W4-A: the accessibility building blocks of the live surfaces. */

const liveSlide = (patch: Partial<LiveSlide>): LiveSlide => ({
  slideIndex: 0,
  totalSlides: 3,
  type: "select_answer",
  scored: true,
  question: "Which planet is red?",
  options: [{ text: "Mars" }, { text: "Venus" }],
  statements: [],
  minLabel: "",
  maxLabel: "",
  scaleMax: 5,
  items: [],
  maxEntries: 3,
  timeLimit: 30,
  points: 1000,
  scoreDependsOnTime: true,
  ...patch,
});

const inIntl = (node: React.ReactNode) => renderToStaticMarkup(<LiveIntlProvider>{node}</LiveIntlProvider>);

describe("timer", () => {
  test("milestones are crossed once, from above, never every second", () => {
    expect(TIMER_MILESTONES).toEqual([60, 30, 10]);
    expect(crossedMilestone(11, 10)).toBe(10);
    expect(crossedMilestone(31, 29)).toBe(30);
    expect(crossedMilestone(10, 9)).toBeNull();
    expect(crossedMilestone(25, 24)).toBeNull();
    // A timer that starts under a milestone never announces it.
    expect(crossedMilestone(8, 8)).toBeNull();
  });

  test("the readout is a named, silent role=timer with a separate polite region", () => {
    const html = inIntl(<Timer secondsLeft={42} progress={0.7} />);
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-live="off"');
    expect(html).toContain('aria-label="Time left"');
    expect(html).toMatch(/aria-live="polite"[^>]*data-testid="timer-announcement"/);
    expect(inIntl(<Timer secondsLeft={42} progress={0.7} paused />)).toContain('aria-label="Time left, paused"');
  });
});

describe("announcer", () => {
  test("both live regions exist before anything is said", () => {
    const html = renderToStaticMarkup(
      <LiveAnnouncer>
        <p>content</p>
      </LiveAnnouncer>
    );
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('role="alert" aria-live="assertive" aria-atomic="true"');
  });

  test("screen-reader sentences never repeat a visible label word for word", () => {
    const visible = [
      ...Object.values(enMessages.live.participant),
      ...Object.values(enMessages.live.audience),
      enMessages.live.participant.slideCounter.replace("{current}", "1").replace("{total}", "3"),
    ].map((text) => String(text).toLowerCase());
    for (const sentence of Object.values(enMessages.live.announce)) {
      const spoken = sentence.toLowerCase().replace(/\{[a-z]+\}/g, "1");
      for (const label of visible) {
        if (label.length < 8 || label.includes("{")) continue;
        expect([sentence, spoken.includes(label)]).toEqual([sentence, false]);
      }
    }
  });
});

describe("answer forms", () => {
  test("single select: a named group of pressed/unpressed buttons; letters are decoration", () => {
    const html = inIntl(<SelectAnswerParticipant slide={liveSlide({})} mode="live" onSubmit={() => {}} submitting={false} />);
    expect(html).toContain('role="group" aria-label="Answer options"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-hidden="true"[^>]*>A</);
  });

  test("ranking: every move button is named after its item and 44 px", () => {
    const html = inIntl(
      <RankingParticipant
        slide={liveSlide({ type: "ranking", scored: false, items: ["Speed", "Docs"] })}
        mode="live"
        onSubmit={() => {}}
        submitting={false}
      />
    );
    for (const name of ["Move Speed up", "Move Speed down", "Move Docs up", "Move Docs down"]) {
      expect(html).toContain(`aria-label="${name}"`);
    }
    expect(html.match(/size-11/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('aria-live="polite"');
  });

  test("a submitting button keeps a name for screen readers", () => {
    const html = inIntl(<SelectAnswerParticipant slide={liveSlide({})} mode="live" onSubmit={() => {}} submitting />);
    expect(html).toContain('<span class="sr-only">Sending your answer…</span>');
  });
});

describe("stage results box", () => {
  test("scrollable boxes are focusable and named, except in thumbnails", () => {
    expect(stageScrollProps("live", "Q")).toEqual({ tabIndex: 0, role: "group", "aria-label": "Q" });
    expect(stageScrollProps("reveal", "Q")).toEqual({ tabIndex: 0, role: "group", "aria-label": "Q" });
    expect(stageScrollProps("thumbnail", "Q")).toEqual({});
  });
});
