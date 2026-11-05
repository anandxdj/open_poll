import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import "@/features/registrations";
import { apiClient } from "@/lib/api-client";
import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";
import { AudienceResults } from "@/features/presentations/components/participant/audience/AudienceResults";
import { AudienceRun } from "@/features/presentations/components/participant/audience/AudienceRun";
import { describeResponse } from "@/features/presentations/components/participant/audience/AudienceSlideCard";
import {
  AUDIENCE_PREFIX,
  audienceSliceOf,
  initialAudienceSlice,
  type AudienceSlice,
} from "@/features/presentations/components/participant/audience/audienceSlice";
import { AudienceDashboard } from "@/features/presentations/components/host/AudienceDashboard";
import type { HostSession } from "@/features/presentations/components/host/useHostSession";
import {
  paceSettingsFrom,
  parseBounded,
  DEFAULT_PACE_SETTINGS,
} from "@/features/presentations/components/builder/tabs/PaceSettings";
import { createMemoryAnswerStorage } from "@/features/presentations/live/offline";
import { createLiveStore, LiveStoreProvider } from "@/features/presentations/live/store";
import { getSlideRuntime } from "@/features/presentations/slides/runtime";
import type {
  AudienceParticipantView,
  AudienceSlideView,
  HostAudienceView,
  ParticipantLiveState,
} from "@/features/presentations/types";
import { PID, SELF, SID, SLIDE_IDS, liveSlide } from "./live.fixtures";

// Audience pace (W2-F): the live slice, answers to a slide that is not "current",
// the builder's Pace tab helpers, and what the phone and the host dashboard render.

const windowOpen = { openedAt: "2026-11-05T10:00:00.000Z", closesAt: null, closedAt: null, closeReason: null };

const slideView = (index: number, overrides: Partial<AudienceSlideView> = {}): AudienceSlideView => ({
  slideId: SLIDE_IDS[index]!,
  slideIndex: index,
  lifecycle: "response",
  slide: liveSlide({ slideIndex: index, totalSlides: 2, question: `Question ${index + 1}`, options: [{ text: "Green" }, { text: "Purple" }] }),
  phase: "open",
  slideTicket: "st1.abc",
  answered: false,
  response: null,
  isCorrect: null,
  score: null,
  explanation: null,
  results: null,
  ...overrides,
});

const run = (overrides: Partial<AudienceParticipantView> = {}): AudienceParticipantView => ({
  status: "open",
  window: windowOpen,
  resultsVisibility: "after_submit",
  assessment: { enabled: true, passingScorePercentage: 60, maxAttempts: 2 },
  attempt: { number: 1, submitted: false, submittedAt: null },
  attempts: [],
  attemptsLeft: 1,
  canRetry: false,
  final: false,
  slides: [slideView(0), slideView(1)],
  ...overrides,
});

const liveStateWith = (audience: AudienceParticipantView | null): ParticipantLiveState => ({
  presentationId: PID,
  sessionId: SID,
  title: "Safety check",
  status: "active",
  pace: "audience",
  joinCode: "123456",
  totalSlides: 2,
  serverNow: "2026-11-05T10:00:00.000Z",
  settings: null,
  theme: null,
  current: null,
  me: { participantId: SELF.participantId, name: "Ada", totalScore: 0, correctCount: 0, rank: 1, answeredCurrent: false, lastAnswer: null },
  finalLeaderboard: null,
  audience,
});

const participantStore = () =>
  createLiveStore(
    "participant",
    { presentationId: PID, sessionId: SID, self: SELF, status: "active" },
    { answerRetryDelaysMs: [1, 1], answerQueue: createMemoryAnswerStorage(), isOnline: () => true }
  );

/** A participant store already holding a run (server rendering reads the store's initial state). */
const storeWithRun = (audience: Partial<AudienceSlice>) =>
  createLiveStore("participant", {
    presentationId: PID,
    sessionId: SID,
    self: SELF,
    status: "active",
    modules: { [AUDIENCE_PREFIX]: { ...initialAudienceSlice, pace: "audience", ...audience } },
  });

const render = (store: ReturnType<typeof createLiveStore>, node: React.ReactNode) =>
  renderToStaticMarkup(
    <LiveIntlProvider>
      <LiveStoreProvider store={store}>{node}</LiveStoreProvider>
    </LiveIntlProvider>
  );

describe("audience live slice", () => {
  test("live-state brings the run and the pace; answers mark slides until the next view", () => {
    const store = participantStore();
    store.getState().dispatch({ type: "participant/live-state", state: liveStateWith(run()) });
    expect(audienceSliceOf(store.getState())).toMatchObject({ pace: "audience", answered: {} });
    expect(audienceSliceOf(store.getState()).participant?.slides).toHaveLength(2);

    store.getState().dispatch({ type: "participant/submitted", slideIndex: 1, slideId: SLIDE_IDS[1] });
    expect(audienceSliceOf(store.getState()).answered).toEqual({ [SLIDE_IDS[1]!]: true });
    store.getState().dispatch({ type: "participant/answer-synced", slideId: SLIDE_IDS[0]!, slideIndex: 0, clientAnswerId: "c" });
    expect(Object.keys(audienceSliceOf(store.getState()).answered).sort()).toEqual([SLIDE_IDS[0], SLIDE_IDS[1]].sort());

    // A submit's answer replaces the run and the local marks.
    const submitted = run({ attempt: { number: 1, submitted: true, submittedAt: "2026-11-05T10:05:00.000Z" } });
    store.getState().dispatch({ type: "live/module", prefix: AUDIENCE_PREFIX, name: "view", payload: submitted });
    expect(audienceSliceOf(store.getState())).toMatchObject({ answered: {}, participant: { attempt: { submitted: true } } });
  });

  test("audience:opened and audience:closed keep the window; the code lookup brings the nickname rule", () => {
    const store = participantStore();
    store.getState().dispatch({
      type: "participant/info-loaded",
      info: { title: "T", status: "lobby", totalSlides: 2, currentSlideIndex: -1, serverNow: "x", pace: "audience", nickname: "optional", audience: null },
      sessionId: SID,
    });
    expect(audienceSliceOf(store.getState())).toMatchObject({ pace: "audience", nickname: "optional" });
    store.getState().dispatch({
      type: "live/event",
      event: { type: "audience:opened", sessionId: SID, payload: { openedAt: "a", closesAt: "b", serverNow: "c" }, emittedAt: "c" },
    });
    expect(audienceSliceOf(store.getState()).window).toEqual({ openedAt: "a", closesAt: "b", closedAt: null, closeReason: null });
    store.getState().dispatch({
      type: "live/event",
      event: { type: "audience:closed", sessionId: SID, payload: { closedAt: "d", reason: "schedule" }, emittedAt: "d" },
    });
    expect(audienceSliceOf(store.getState()).window).toEqual({ openedAt: "a", closesAt: "b", closedAt: "d", closeReason: "schedule" });
  });
});

describe("submitAnswer to a slide that is not current (audience pace)", () => {
  test("posts the slide, its ticket and the attempt, then re-reads the run", async () => {
    const post = spyOn(apiClient, "post").mockResolvedValue({
      data: { data: { accepted: true, replay: false, slideId: SLIDE_IDS[1], slideIndex: 1, clientAnswerId: "x", via: "rest", answeredAt: "t" } },
    });
    const get = spyOn(apiClient, "get").mockResolvedValue({ data: { data: liveStateWith(run()) } });
    try {
      const store = participantStore();
      const result = await store.getState().submitAnswer(
        { optionIndex: 0 },
        { slideId: SLIDE_IDS[1]!, slideIndex: 1, slideTicket: "st1.abc", attempt: 2 }
      );
      expect(result).toMatchObject({ status: "accepted" });
      expect(post).toHaveBeenCalledWith(
        `/presentations/${PID}/answer`,
        {
          participantId: SELF.participantId,
          participantToken: SELF.token,
          slideIndex: 1,
          sessionId: SID,
          slideId: SLIDE_IDS[1],
          slideTicket: "st1.abc",
          clientAnswerId: (result as { clientAnswerId: string }).clientAnswerId,
          attempt: 2,
          optionIndex: 0,
        },
        { timeout: 10_000 }
      );
      expect(audienceSliceOf(store.getState()).answered[SLIDE_IDS[1]!]).toBe(true);
      // The whole run is re-read (live-state), not just `/me`.
      expect(get.mock.calls.some(([url]) => String(url).endsWith("/live-state"))).toBe(true);
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });
});

describe("Pace tab helpers", () => {
  test("reads a stored deck, defaulting decks saved before audience pace", () => {
    expect(paceSettingsFrom({})).toEqual(DEFAULT_PACE_SETTINGS);
    expect(
      paceSettingsFrom({
        pace: "audience",
        settings: {
          nickname: "off",
          audiencePaced: {
            resultsVisibility: "never",
            closeAfterMinutes: 45,
            assessment: { enabled: true, passingScorePercentage: 80, maxAttempts: null },
          },
        },
      })
    ).toEqual({
      pace: "audience",
      nickname: "off",
      resultsVisibility: "never",
      closeAfterMinutes: 45,
      assessment: { enabled: true, passingScorePercentage: 80, maxAttempts: null },
    });
  });

  test("number fields take whole numbers in range only", () => {
    expect(parseBounded("60", 0, 100)).toBe(60);
    expect(parseBounded(" 7 ", 1, 10)).toBe(7);
    expect(parseBounded("101", 0, 100)).toBeNull();
    expect(parseBounded("2.5", 0, 100)).toBeNull();
    expect(parseBounded("", 0, 100)).toBeNull();
    expect(parseBounded("-1", 0, 100)).toBeNull();
  });
});

describe("participant views", () => {
  test("describes what was sent: options, multi-picks, text, words", () => {
    expect(describeResponse(slideView(0, { response: { optionIndex: 1, text: null, payload: null } }))).toBe("Purple");
    expect(describeResponse(slideView(0, { response: { optionIndex: null, text: null, payload: { optionIndices: [0, 1] } } }))).toBe(
      "Green, Purple"
    );
    expect(describeResponse(slideView(0, { response: { optionIndex: null, text: "Because", payload: null } }))).toBe("Because");
    expect(describeResponse(slideView(0, { response: { optionIndex: null, text: null, payload: { entries: ["a", "b"] } } }))).toBe("a, b");
    expect(describeResponse(slideView(0))).toBeNull();
  });

  test("results: bars with counts, correct options marked only when sent as correct", () => {
    const html = render(
      participantStore(),
      <AudienceResults
        results={{
          slideId: SLIDE_IDS[0]!,
          slideIndex: 0,
          type: "select_answer",
          scored: true,
          answeredCount: 3,
          participantCount: 4,
          distribution: { kind: "options", counts: [2, 1], options: [{ text: "Green", isCorrect: true }, { text: "Purple", isCorrect: false }] },
        }}
      />
    );
    expect(html).toContain("Green");
    expect(html).toContain("3 responses");
    expect(html).toContain('aria-label="Correct"');
    expect(html).toContain("width:67%");
  });

  test("the run: waiting screen, then progress, slide strip and the first open question", () => {
    const waiting = storeWithRun({ participant: run({ status: "waiting", slides: [] }) });
    expect(render(waiting, <AudienceRun />)).toContain("The host will open the questions soon");

    const html = render(storeWithRun({ participant: run() }), <AudienceRun />);
    expect(html).toContain("0 of 2 answered");
    expect(html).toContain("Question 1");
    expect(html).toContain('aria-label="Go to slide 2"');
    expect(html).toContain("Slide 1 of 2");
  });

  test("a submitted, failed attempt opens on the result with pass mark and a retry", () => {
    const failed = run({
      attempt: { number: 1, submitted: true, submittedAt: "2026-11-05T10:05:00.000Z" },
      attempts: [
        { number: 1, submittedAt: "2026-11-05T10:05:00.000Z", score: 1, maxScore: 2, percentage: 50, correctCount: 1, answeredCount: 2, totalQuestions: 2, passed: false },
      ],
      canRetry: true,
    });
    const html = render(storeWithRun({ participant: failed }), <AudienceRun />);
    expect(html).toContain("50%");
    expect(html).toContain("Not passed");
    expect(html).toContain("Pass mark 60%");
    expect(html).toContain("1 attempt left");
    expect(html).toContain("Try again");
  });
});

describe("answer forms in audience mode", () => {
  test("a multi-select slide takes answers on the phone (only preview is inert)", () => {
    const runtime = getSlideRuntime("select_answer")!;
    const slide = liveSlide({ type: "select_answer", allowMultiple: true, options: [{ text: "A" }, { text: "B" }] });
    const disabledIn = (mode: "audience" | "preview") =>
      (render(participantStore(), <runtime.ParticipantView slide={slide} mode={mode} onSubmit={() => {}} submitting={false} />).match(/disabled=""/g) ?? []).length;
    // Audience: only the submit button waits for a pick. Preview: both options and the button.
    expect(disabledIn("audience")).toBe(1);
    expect(disabledIn("preview")).toBe(3);
  });
});

describe("host dashboard", () => {
  test("shows who is in, progress per question and completions", () => {
    const view: HostAudienceView = {
      window: { openedAt: "2026-11-05T10:00:00.000Z", closesAt: "2026-11-05T11:00:00.000Z", closedAt: null, closeReason: null },
      resultsVisibility: "after_submit",
      assessment: { enabled: true, passingScorePercentage: 60, maxAttempts: 2 },
      totalQuestions: 2,
      participantCount: 2,
      startedCount: 2,
      completedCount: 1,
      passedCount: 1,
      failedCount: 0,
      slides: [
        { slideId: SLIDE_IDS[0]!, slideIndex: 0, type: "select_answer", label: "Fire exit colour?", scored: true, answeredCount: 2 },
        { slideId: SLIDE_IDS[1]!, slideIndex: 1, type: "select_answer", label: "Alarm test day?", scored: true, answeredCount: 1 },
      ],
      participants: [
        { participantId: "a", name: "Ada", joinedAt: "x", kicked: false, attempt: 1, answeredCount: 2, submitted: true, lastResult: { number: 1, submittedAt: "x", score: 2, maxScore: 2, percentage: 100, correctCount: 2, answeredCount: 2, totalQuestions: 2, passed: true } },
        { participantId: "b", name: "Bob", joinedAt: "x", kicked: false, attempt: 1, answeredCount: 1, submitted: false, lastResult: null },
      ],
    };
    const store = createLiveStore("host", {
      presentationId: PID,
      sessionId: SID,
      status: "active",
      joinCode: "123456",
      title: "Safety check",
      modules: { [AUDIENCE_PREFIX]: { ...initialAudienceSlice, pace: "audience", host: view, window: view.window } },
    });
    // The slice takes the dashboard data from host state.
    const loaded = createLiveStore("host", { presentationId: PID });
    loaded.getState().dispatch({
      type: "host/state-loaded",
      state: { serverNow: "x", session: null, participants: [], answeredCount: 0, leaderboard: [], slideStates: [], distributions: {}, audience: view },
    });
    expect(audienceSliceOf(loaded.getState()).host?.completedCount).toBe(1);
    const session = { busy: false, openAudience: async () => null, closeAudience: async () => null, openLobby: async () => {}, end: async () => {} } as unknown as HostSession;
    const html = render(store, <AudienceDashboard presentationId={PID} session={session} />);
    expect(html).toContain("Audience pace");
    expect(html).toContain("Fire exit colour?");
    expect(html).toContain("2 of 2 answered");
    expect(html).toContain("1 of 2");
    expect(html).toContain("Passed · 100%");
    expect(html).toContain("In progress");
    expect(html).toContain("Close now");
    expect(html).toContain("pass mark 60%");
  });
});
