import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { StageView } from "@/features/presentations/components/stage/StageView";
import {
  createInitialLiveState,
  liveReducer,
  type LiveAction,
  type LiveRole,
  type LiveState,
} from "@/features/presentations/live/reducer";
import { createLiveStore, LiveStoreProvider } from "@/features/presentations/live/store";
import { getSlotEntries } from "@/features/presentations/live/slots";
import { blankSlide, cleanSlide, normalizeSlideForDraft, validateSlide } from "@/features/presentations/slides/editor";
import { getSlideRuntime } from "@/features/presentations/slides/runtime";
import { audienceTab } from "@/features/qna/builder/AudienceTab";
import { HighlightOverlay } from "@/features/qna/components/HighlightOverlay";
import { HostQnaPanel } from "@/features/qna/components/HostQnaPanel";
import { QnaBoard } from "@/features/qna/components/QnaBoard";
import { QnaPanel } from "@/features/qna/components/QnaPanel";
import { registerQnaModule } from "@/features/qna/module";
import { qnaActions } from "@/features/qna/state";
import { forgetQnaTabs, qnaTabAvailable, rememberQnaTab } from "@/features/qna/tabAvailability";
import type { QnaHostQuestion, QnaParticipantQuestion, QnaQuestionView, QnaSettingsView } from "@/features/qna/types";
import { ReactionsBar } from "@/features/reactions/components/ReactionsBar";
import { registerReactionsModule } from "@/features/reactions/module";

const PID = "64b000000000000000000001";
const SID = "64b0000000000000000000a1";
const SELF = { participantId: "p1", name: "Ada", token: "t".repeat(32) };

let disposers: Array<() => void> = [];
beforeAll(() => {
  disposers = [registerQnaModule(), registerReactionsModule()];
});
afterAll(() => disposers.forEach((dispose) => dispose()));

const question = (over: Partial<QnaQuestionView> = {}): QnaQuestionView => ({
  id: "q1",
  sessionId: SID,
  slideId: null,
  text: "How does it scale?",
  authorName: "Grace",
  anonymous: false,
  status: "visible",
  pinned: false,
  upvoteCount: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  answeredAt: null,
  ...over,
});

const settings = (over: Partial<QnaSettingsView> = {}): QnaSettingsView => ({
  enabled: true,
  moderation: false,
  anonymousAllowed: true,
  upvotes: true,
  open: true,
  onBoard: false,
  hasBoard: false,
  ...over,
});

const others = (over: Partial<QnaQuestionView> = {}): QnaParticipantQuestion => ({ ...question(over), mine: false, upvoted: false });
const asHost = (over: Partial<QnaQuestionView> = {}): QnaHostQuestion => ({ ...question(over), participantId: "px", highlighted: false });

/** Renders `ui` against a store whose state is `actions` applied to a fresh one (SSR reads the initial state). */
function renderWith(
  role: LiveRole,
  actions: LiveAction[],
  ui: ReactNode,
  init: Partial<LiveState> = {}
): string {
  const base = createInitialLiveState(role, {
    presentationId: PID,
    status: "active",
    self: role === "participant" ? SELF : null,
    ...init,
  });
  const state = actions.reduce(liveReducer, base);
  const store = createLiveStore(role, state);
  return renderToStaticMarkup(
    <LiveIntlProvider>
      <LiveStoreProvider store={store}>{ui}</LiveStoreProvider>
    </LiveIntlProvider>
  );
}

const loaded = (questions: QnaParticipantQuestion[], qna: Partial<QnaSettingsView> = {}, reactions = { enabled: true, emojis: ["👍", "🎉"] }) =>
  qnaActions.loadedForParticipant({ sessionId: SID, qna: settings(qna), reactions, highlightedId: null, questions });

describe("participant Q&A panel", () => {
  test("before the list arrives it shows a spinner, not the form", () => {
    const html = renderWith("participant", [], <QnaPanel />);
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("<textarea");
  });

  test("open: ask form with a label, counter, anonymous option and the visible questions", () => {
    const html = renderWith("participant", [loaded([others()])], <QnaPanel />);
    expect(html).toContain('for="qna-ask"');
    expect(html).toContain("Your question");
    expect(html).toContain("<textarea");
    expect(html).toContain("280 left");
    expect(html).toContain("Ask anonymously");
    expect(html).toContain("How does it scale?");
    expect(html).toContain("Grace");
    expect(html).toContain('aria-label="Upvote: How does it scale?"');
    expect(html).not.toContain("reviews questions");
  });

  test("moderated decks say so; anonymous questions can be switched off", () => {
    const html = renderWith("participant", [loaded([], { moderation: true, anonymousAllowed: false })], <QnaPanel />);
    expect(html).toContain("The host reviews questions before they appear.");
    expect(html).not.toContain("Ask anonymously");
  });

  test("closed: explains why, no form", () => {
    const off = renderWith("participant", [loaded([others()], { enabled: false, open: false })], <QnaPanel />);
    expect(off).toContain("Q&amp;A isn&#x27;t open right now.");
    expect(off).not.toContain("<textarea");
    expect(off).toContain("How does it scale?");
    const ended = renderWith("participant", [loaded([], {})], <QnaPanel />, { status: "ended" });
    expect(ended).toContain("This session has ended.");
  });

  test("own pending question is listed with its status and cannot be upvoted; others' pending ones are not", () => {
    const html = renderWith(
      "participant",
      [
        loaded([
          { ...question({ id: "mine", text: "Is mine ok?", status: "pending", authorName: "Ada" }), mine: true, upvoted: false },
          others({ id: "o1", text: "Visible one" }),
        ]),
        // A pending question of someone else must never reach the list, even if an event slipped through.
        qnaActions.asked({ ...question({ id: "x", text: "Not mine", status: "pending" }), mine: false, upvoted: false }),
      ],
      <QnaPanel />
    );
    expect(html).toContain("Is mine ok?");
    expect(html).toContain("Waiting for approval");
    expect(html).not.toContain('aria-label="Upvote: Is mine ok?"');
    expect(html).toContain("You");
    expect(html).toContain('aria-label="Upvote: Visible one"');
  });

  test("a participant cannot upvote their own visible question, nor anything when upvotes are off", () => {
    const own = renderWith(
      "participant",
      [loaded([{ ...question({ id: "m", text: "Mine" }), mine: true, upvoted: false }, others({ id: "o", text: "Theirs" })])],
      <QnaPanel />
    );
    expect(own).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Upvote: Mine"|<button[^>]*aria-label="Upvote: Mine"[^>]*disabled=""/);
    expect(own).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Upvote: Theirs"|<button[^>]*aria-label="Upvote: Theirs"[^>]*disabled=""/);

    const off = renderWith("participant", [loaded([others({ text: "Theirs" })], { upvotes: false })], <QnaPanel />);
    expect(off).toMatch(/aria-label="Upvote: Theirs"/);
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Upvote: Theirs"|<button[^>]*aria-label="Upvote: Theirs"[^>]*disabled=""/);
  });

  test("upvoted, answered, pinned and on-screen questions are marked", () => {
    const html = renderWith(
      "participant",
      [
        loaded([
          { ...question({ id: "a", text: "Answered one", status: "answered" }), mine: false, upvoted: true },
          others({ id: "p", text: "Pinned one", pinned: true }),
        ]),
        liveReducerAction("qna:highlight", { question: question({ id: "p", text: "Pinned one", pinned: true }) }),
      ],
      <QnaPanel />
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Answered");
    expect(html).toContain("Pinned");
    expect(html).toContain("On screen");
  });

  test("anonymous questions show no name", () => {
    const html = renderWith("participant", [loaded([others({ text: "Hidden", authorName: null, anonymous: true })])], <QnaPanel />);
    expect(html).toContain("Anonymous");
  });
});

function liveReducerAction(type: string, payload: Record<string, unknown>): LiveAction {
  return {
    type: "live/event",
    event: { quizId: PID, presentationId: PID, type, payload, emittedAt: "2026-01-01T00:00:00.000Z", sessionId: SID },
  };
}

describe("host moderation panel", () => {
  const hostLoad = (questions: QnaHostQuestion[], qna: Partial<QnaSettingsView> = {}, highlightedId: string | null = null) =>
    qnaActions.loadedForHost({ sessionId: SID, qna: settings({ moderation: true, ...qna }), highlightedId, questions });

  test("filters carry counts and the pending tab lists approve/reject for each question", () => {
    const html = renderWith(
      "host",
      [hostLoad([asHost({ id: "a", text: "Wait for me", status: "pending" }), asHost({ id: "b", text: "Already up" })])],
      <HostQnaPanel />
    );
    expect(html).toContain("Moderation on");
    for (const label of ["Pending", "Visible", "Answered", "Archived", "Rejected"]) expect(html).toContain(label);
    expect(html).toContain("Wait for me");
    expect(html).not.toContain("Already up");
    expect(html).toContain('aria-label="Approve: Wait for me"');
    expect(html).toContain('aria-label="Reject: Wait for me"');
    expect(html).toContain('role="tab"');
  });

  test("nothing waiting shows the empty message; closed sessions say so", () => {
    const html = renderWith("host", [hostLoad([], { open: false })], <HostQnaPanel />);
    expect(html).toContain("Nothing waiting for approval.");
    expect(html).toContain("Q&amp;A is closed for this session.");
  });

  test("before the list arrives it shows a spinner", () => {
    expect(renderWith("host", [], <HostQnaPanel />)).toContain("animate-spin");
  });
});

describe("stage views", () => {
  test("board: most upvoted first, answered ones dimmed at the end, overflow counted", () => {
    const questions = Array.from({ length: 10 }, (_, i) =>
      asHost({ id: `q${i}`, text: `Question ${i}`, upvoteCount: i, createdAt: `2026-01-01T00:00:0${i}.000Z` })
    );
    questions.push(asHost({ id: "done", text: "Done one", status: "answered", upvoteCount: 99 }));
    const html = renderWith("host", [qnaActions.loadedForHost({ sessionId: SID, qna: settings(), highlightedId: null, questions })], <QnaBoard />, { joinCode: "123456" });
    expect(html.indexOf("Question 9")).toBeLessThan(html.indexOf("Question 8"));
    expect(html).not.toContain("Done one");
    expect(html).toContain("3 more questions");
    expect(html).toContain("Ask from your phone with join code 123456");
  });

  test("board: empty look and the thumbnail look need no data", () => {
    expect(renderWith("host", [], <QnaBoard />)).toContain("Questions from the audience will show up here.");
    const thumb = renderToStaticMarkup(
      <LiveIntlProvider>
        <QnaBoard thumbnail />
      </LiveIntlProvider>
    );
    expect(thumb).toContain("Questions");
    expect(thumb).not.toContain("show up here");
  });

  test("the Q&A slide type renders through the runtime registry", () => {
    const runtime = getSlideRuntime("qna")!;
    expect(runtime.lifecycle).toBe("board");
    const slide = { ...blankSlide("qna"), question: "Ask away" };
    const html = renderToStaticMarkup(
      <LiveIntlProvider>
        <StageView slide={slide} mode="thumbnail" />
      </LiveIntlProvider>
    );
    expect(html).toContain("Questions");
  });

  test("the highlighted question is drawn over the stage, and only that one", () => {
    const html = renderWith(
      "host",
      [
        qnaActions.loadedForHost({
          sessionId: SID,
          qna: settings(),
          highlightedId: "q1",
          questions: [asHost({ id: "q1", text: "Why the delay?", authorName: null, anonymous: true }), asHost({ id: "q2", text: "Other one" })],
        }),
      ],
      <HighlightOverlay />
    );
    expect(html).toContain("Why the delay?");
    expect(html).toContain("Anonymous");
    expect(html).not.toContain("Other one");
    expect(renderWith("host", [], <HighlightOverlay />)).not.toContain("blockquote");
  });
});

describe("participant Q&A slide", () => {
  test("preview mode is an inert stand-in; live mode is the real panel", () => {
    const runtime = getSlideRuntime("qna")!;
    const slide = { slideIndex: 0, totalSlides: 1, type: "qna" as const, scored: false, question: "Ask us", options: [], statements: [], minLabel: "", maxLabel: "", scaleMax: 5, items: [], maxEntries: 3, timeLimit: 0, points: 0, scoreDependsOnTime: false };
    const preview = renderToStaticMarkup(
      <LiveIntlProvider>
        <runtime.ParticipantView slide={slide} mode="preview" onSubmit={() => {}} submitting={false} />
      </LiveIntlProvider>
    );
    expect(preview).toContain("Ask us");
    expect(preview).not.toContain("<textarea");

    const live = renderWith("participant", [loaded([])], <runtime.ParticipantView slide={slide} mode="live" onSubmit={() => {}} submitting={false} />);
    expect(live).toContain("<textarea");
  });
});

describe("reactions bar", () => {
  test("one button per allowed emoji, named for screen readers", () => {
    const html = renderWith("participant", [loaded([], {}, { enabled: true, emojis: ["👍", "🎉"] })], <ReactionsBar />);
    expect(html).toContain('aria-label="Send reaction 👍"');
    expect(html).toContain('aria-label="Send reaction 🎉"');
    expect(html).toContain('aria-label="Send a reaction"');
  });

  test("nothing renders when reactions are off, unknown or the session ended", () => {
    expect(renderWith("participant", [loaded([], {}, { enabled: false, emojis: ["👍"] })], <ReactionsBar />)).toBe("");
    expect(renderWith("participant", [], <ReactionsBar />)).toBe("");
    expect(renderWith("participant", [loaded([], {})], <ReactionsBar />, { status: "ended" })).toBe("");
  });
});

describe("registrations", () => {
  const props = { presentationId: PID, participantId: "p1" };

  test("Q&A and reactions plug into the documented slots", () => {
    const ids = (slot: Parameters<typeof getSlotEntries>[0]) => getSlotEntries(slot).map((entry) => entry.id);
    expect(ids("participantTabs")).toContain("qna");
    expect(ids("participantBanner")).toContain("qna-sync");
    expect(ids("participantFooter")).toContain("reactions");
    expect(ids("hostToolbar")).toContain("qna");
    expect(ids("presenterPanels")).toContain("qna");
    expect(ids("stageOverlays")).toEqual(expect.arrayContaining(["qna-highlight", "reactions"]));
    expect(getSlotEntries("participantTabs").find((e) => e.id === "qna")?.label).toBe("Q&A");
  });

  test("the tab shows until the deck is known not to use Q&A", () => {
    forgetQnaTabs();
    const when = () => getSlotEntries("participantTabs", props).some((e) => e.id === "qna");
    expect(when()).toBe(true);
    rememberQnaTab(PID, false);
    expect(qnaTabAvailable(PID)).toBe(false);
    expect(when()).toBe(false);
    rememberQnaTab(PID, true);
    expect(when()).toBe(true);
    forgetQnaTabs();
  });
});

describe("Q&A slide editor", () => {
  test("a blank board needs no question or timer and always saves", () => {
    const blank = blankSlide("qna");
    expect(blank).toMatchObject({ type: "qna", question: "", timeLimit: 0, points: 0, scoreDependsOnTime: false });
    expect(validateSlide(cleanSlide(blank))).toBeNull();
    expect(cleanSlide({ ...blank, question: "  Ask us  ", timeLimit: 45 })).toMatchObject({ question: "Ask us", timeLimit: 0 });
  });

  test("draft saves leave the heading empty instead of 'Untitled Question'", () => {
    expect(normalizeSlideForDraft(blankSlide("qna")).question).toBe("");
    expect(normalizeSlideForDraft({ ...blankSlide("qna"), question: "Questions" }).question).toBe("Questions");
  });
});

describe("Audience settings tab", () => {
  test("is a deck-level tab for every slide, after the slide's own tabs are listed", () => {
    expect(audienceTab).toMatchObject({ id: "audience", label: "Audience" });
    expect(audienceTab.appliesTo).toBeUndefined();
  });

  test("without a saved deck it asks to save first", () => {
    const html = renderToStaticMarkup(
      <audienceTab.Panel slide={blankSlide("qna")} index={0} onChange={() => {}} deck={{ title: "", slides: [] }} onDeckChange={() => {}} />
    );
    expect(html).toContain("Save the deck first");
  });
});
