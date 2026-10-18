import { afterEach, describe, expect, test } from "bun:test";

import {
  createInitialLiveState,
  isModuleEvent,
  liveReducer,
  registerLiveReducer,
  type LiveAction,
  type LiveState,
} from "@/features/presentations/live/reducer";
import type {
  HostState,
  LiveSlide,
  Presentation,
  PresentationRealtimeEvent,
  PresentationSlide,
  RevealPayload,
} from "@/features/presentations/types";

// ---------- fixtures ----------

const PID = "64b000000000000000000001";

const slide = (overrides: Partial<PresentationSlide> = {}): PresentationSlide => ({
  type: "select_answer",
  question: "Q?",
  options: [
    { text: "A", isCorrect: true },
    { text: "B", isCorrect: false },
  ],
  acceptedAnswers: [],
  statements: [],
  minLabel: "",
  maxLabel: "",
  scaleMax: 5,
  items: [],
  maxEntries: 3,
  timeLimit: 30,
  points: 1000,
  scoreDependsOnTime: true,
  ...overrides,
});

const deck = (overrides: Partial<Presentation> = {}): Presentation => ({
  _id: PID,
  creatorId: "u1",
  title: "Deck",
  joinCode: "123456",
  status: "lobby",
  currentSlideIndex: -1,
  questionStartedAt: null,
  questionEndsAt: null,
  slides: [slide(), slide({ type: "leaderboard", question: "Standings" })],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const liveSlide = (overrides: Partial<LiveSlide> = {}): LiveSlide => ({
  slideIndex: 0,
  totalSlides: 2,
  type: "select_answer",
  scored: true,
  question: "Q?",
  options: [{ text: "A" }, { text: "B" }],
  statements: [],
  minLabel: "",
  maxLabel: "",
  scaleMax: 5,
  items: [],
  maxEntries: 3,
  timeLimit: 30,
  points: 1000,
  scoreDependsOnTime: true,
  ...overrides,
});

const reveal: RevealPayload = {
  slideIndex: 0,
  question: "Q?",
  type: "select_answer",
  scored: true,
  distribution: { kind: "options", counts: [1, 0], options: [{ text: "A", isCorrect: true }, { text: "B", isCorrect: false }] },
  answeredCount: 1,
  participantCount: 2,
  isLastSlide: false,
};

const event = (type: string, payload: Record<string, unknown>): LiveAction => ({
  type: "live/event",
  event: { quizId: PID, presentationId: PID, type, payload, emittedAt: "2026-01-01T00:00:00.000Z" } as PresentationRealtimeEvent,
});

const run = (state: LiveState, ...actions: LiveAction[]) => actions.reduce(liveReducer, state);

const SELF = { participantId: "p1", name: "Ada", token: "t".repeat(32) };

// ---------- tests ----------

describe("liveReducer — core", () => {
  test("reset gives a fresh state for the role, keeping presentationId and self", () => {
    const dirty = { ...createInitialLiveState("host"), answeredCount: 4, title: "x" };
    const next = liveReducer(dirty, { type: "live/reset", role: "participant", presentationId: PID, self: SELF });
    expect(next).toEqual(createInitialLiveState("participant", { presentationId: PID, self: SELF }));
  });

  test("connection only changes state when the value changes", () => {
    const state = createInitialLiveState("host");
    expect(liveReducer(state, { type: "live/connection", connected: false })).toBe(state);
    expect(liveReducer(state, { type: "live/connection", connected: true }).connected).toBe(true);
  });

  test("unknown events leave the state untouched", () => {
    const host = createInitialLiveState("host");
    const participant = createInitialLiveState("participant");
    expect(liveReducer(host, event("qna:question", {}))).toBe(host);
    expect(liveReducer(participant, event("qna:question", {}))).toBe(participant);
  });

  test("never mutates its input", () => {
    const state = createInitialLiveState("participant", { participants: [] });
    const frozen = Object.freeze({ ...state, participants: Object.freeze([...state.participants]) }) as LiveState;
    expect(() =>
      run(
        frozen,
        event("participant:joined", { participantId: "p2", name: "Grace", participantCount: 2 }),
        event("question:started", { slide: liveSlide(), startedAt: "", endsAt: "2026-01-01T00:00:30.000Z", serverNow: "2026-01-01T00:00:00.000Z" })
      )
    ).not.toThrow();
  });
});

describe("liveReducer — host", () => {
  const hostState = (d: Presentation, extra: Partial<HostState> = {}): HostState => ({
    presentation: d,
    serverNow: "2026-01-01T00:00:01.000Z",
    participants: [{ participantId: "p1", name: "Ada", score: 0 }],
    answeredCount: 1,
    liveDistribution: null,
    leaderboard: [],
    ...extra,
  });

  test("state-loaded copies deck fields and derives timing only while active", () => {
    const lobby = liveReducer(createInitialLiveState("host"), { type: "host/state-loaded", state: hostState(deck()) });
    expect(lobby).toMatchObject({ status: "lobby", title: "Deck", joinCode: "123456", totalSlides: 2, currentSlideIndex: -1, timing: null, answeredCount: 1 });
    expect(lobby.participants).toHaveLength(1);

    const active = deck({ status: "active", currentSlideIndex: 0, questionEndsAt: "2026-01-01T00:00:30.000Z" });
    const next = liveReducer(lobby, { type: "host/state-loaded", state: hostState(active) });
    expect(next.timing).toEqual({ endsAt: "2026-01-01T00:00:30.000Z", serverNow: "2026-01-01T00:00:01.000Z" });
  });

  test("state-loaded keeps the select_answer settings the stage reads (answer keys, config, points)", () => {
    const converted = slide({
      points: 0,
      options: [
        { text: "A", isCorrect: false },
        { text: "B", isCorrect: false },
      ],
      config: { allowMultiple: true, explanation: "Why" },
    });
    const next = liveReducer(createInitialLiveState("host"), {
      type: "host/state-loaded",
      state: hostState(deck({ slides: [converted, slide({ config: null })] })),
    });
    expect(next.deck?.slides[0]).toEqual(converted);
    expect(next.deck?.slides[1].config).toBeNull();
  });

  test("state-loaded prefers the deck override (lobby opened after loading)", () => {
    const next = liveReducer(createInitialLiveState("host"), {
      type: "host/state-loaded",
      state: hostState(deck({ status: "ended" })),
      deck: deck({ status: "lobby" }),
    });
    expect(next.status).toBe("lobby");
  });

  test("state-loaded keeps the previous distribution when the server sends none", () => {
    const dist = reveal.distribution;
    const state = { ...createInitialLiveState("host"), distribution: dist };
    expect(liveReducer(state, { type: "host/state-loaded", state: hostState(deck()) }).distribution).toBe(dist);
  });

  test("lobby-opened clears the previous session's data", () => {
    const state = { ...createInitialLiveState("host"), participants: [{ participantId: "p", name: "x" }], answeredCount: 3, reveal, leaderboard: [{ participantId: "p", name: "x", score: 1, correctCount: 1, rank: 1 }] };
    const next = liveReducer(state, { type: "host/lobby-opened", deck: deck() });
    expect(next).toMatchObject({ participants: [], answeredCount: 0, reveal: null, distribution: null, leaderboard: [], status: "lobby" });
  });

  test("advanced resets reveal and count and times the countdown from the given clock", () => {
    const active = deck({ status: "active", currentSlideIndex: 0, questionEndsAt: "2026-01-01T00:00:30.000Z" });
    const next = liveReducer({ ...createInitialLiveState("host"), reveal, answeredCount: 2 }, { type: "host/advanced", deck: active, serverNow: "2026-01-01T00:00:00.500Z" });
    expect(next).toMatchObject({ reveal: null, answeredCount: 0, currentSlideIndex: 0, status: "active" });
    expect(next.timing?.serverNow).toBe("2026-01-01T00:00:00.500Z");
  });

  test("participant:joined de-duplicates by id", () => {
    const joined = event("participant:joined", { participantId: "p1", name: "Ada", participantCount: 1 });
    const next = run(createInitialLiveState("host"), joined, joined);
    expect(next.participants).toEqual([{ participantId: "p1", name: "Ada" }]);
  });

  test("answer:received updates the count and keeps the last distribution when absent", () => {
    const withDist = liveReducer(createInitialLiveState("host"), event("answer:received", { answeredCount: 1, distribution: reveal.distribution }));
    expect(withDist).toMatchObject({ answeredCount: 1, distribution: reveal.distribution });
    const countOnly = liveReducer(withDist, event("answer:received", { answeredCount: 2 }));
    expect(countOnly).toMatchObject({ answeredCount: 2, distribution: reveal.distribution });
  });

  test("question:started clears per-slide fields; question:revealed stores the reveal", () => {
    const state = { ...createInitialLiveState("host"), distribution: reveal.distribution, answeredCount: 2 };
    const started = liveReducer(state, event("question:started", { slide: liveSlide(), endsAt: "x", serverNow: "y", startedAt: "z" }));
    expect(started).toMatchObject({ distribution: null, reveal: null, answeredCount: 0, slide: null });
    expect(liveReducer(started, event("question:revealed", { ...reveal })).reveal).toEqual(reveal);
  });

  test("host ignores lobby:opened, leaderboard:shown and quiz:ended (it refetches host state)", () => {
    const state = createInitialLiveState("host");
    expect(liveReducer(state, event("lobby:opened", { joinCode: "1" }))).toBe(state);
    expect(liveReducer(state, event("leaderboard:shown", { slideIndex: 1, leaderboard: [] }))).toBe(state);
    expect(liveReducer(state, event("quiz:ended", { leaderboard: [] }))).toBe(state);
  });
});

describe("liveReducer — participant", () => {
  const joined = () => createInitialLiveState("participant", { self: SELF, presentationId: PID, totalSlides: 2, status: "lobby" });

  test("info-loaded renders a question already running for late joiners", () => {
    const next = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: {
        presentationId: PID,
        title: "Deck",
        status: "active",
        totalSlides: 2,
        currentSlideIndex: 0,
        serverNow: "2026-01-01T00:00:01.000Z",
        currentSlide: liveSlide(),
        questionEndsAt: "2026-01-01T00:00:30.000Z",
      },
    });
    expect(next).toMatchObject({ presentationId: PID, title: "Deck", status: "active", slide: liveSlide() });
    expect(next.timing).toEqual({ endsAt: "2026-01-01T00:00:30.000Z", serverNow: "2026-01-01T00:00:01.000Z" });
  });

  test("info-loaded falls back to the legacy quizId", () => {
    const next = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: { quizId: PID, title: "Deck", status: "lobby", totalSlides: 2, currentSlideIndex: -1, serverNow: "" },
    });
    expect(next.presentationId).toBe(PID);
    expect(next.slide).toBeNull();
  });

  test("question:started shows the slide with the deadline it arrived with", () => {
    const next = run(
      { ...joined(), submittedSlideIndex: 0, me: { participantId: "p1" } as LiveState["me"] },
      event("question:started", { slide: liveSlide({ slideIndex: 1 }), startedAt: "", endsAt: "E", serverNow: "S" })
    );
    expect(next).toMatchObject({ status: "active", currentSlideIndex: 1, timing: { endsAt: "E", serverNow: "S" }, reveal: null, me: null, submittedSlideIndex: null });
  });

  test("a multi-select slide arrives with allowMultiple; single-select slides keep their shape", () => {
    const multi = run(joined(), event("question:started", { slide: liveSlide({ allowMultiple: true }), startedAt: "", endsAt: "E", serverNow: "S" }));
    expect(multi.slide?.allowMultiple).toBe(true);
    const single = run(joined(), event("question:started", { slide: liveSlide(), startedAt: "", endsAt: "E", serverNow: "S" }));
    expect(single.slide).toEqual(liveSlide());
    expect("allowMultiple" in single.slide!).toBe(false);
  });

  test("submitted and me-loaded record the participant's own progress", () => {
    const me = { participantId: "p1", name: "Ada", totalScore: 900, correctCount: 1, rank: 1, lastAnswer: null, quizStatus: "active" as const };
    const next = run(joined(), { type: "participant/submitted", slideIndex: 0 }, { type: "participant/me-loaded", me });
    expect(next.submittedSlideIndex).toBe(0);
    expect(next.me).toEqual(me);
  });

  test("leaderboard:shown swaps in a synthesized leaderboard slide", () => {
    const entries = [{ participantId: "p1", name: "Ada", score: 900, correctCount: 1, rank: 1 }];
    const next = run(
      { ...joined(), reveal, timing: { endsAt: "E", serverNow: "S" } },
      event("leaderboard:shown", { slideIndex: 1, leaderboard: entries, participantCount: 1, isLastSlide: true })
    );
    expect(next.slide).toMatchObject({ type: "leaderboard", slideIndex: 1, totalSlides: 2 });
    expect(next).toMatchObject({ reveal: null, timing: null, leaderboard: entries, currentSlideIndex: 1, status: "active" });
  });

  test("quiz:ended ends the session with the final standings", () => {
    const entries = [{ participantId: "p1", name: "Ada", score: 900, correctCount: 1, rank: 1 }];
    const next = liveReducer(joined(), event("quiz:ended", { leaderboard: entries, participantCount: 1 }));
    expect(next).toMatchObject({ status: "ended", leaderboard: entries });
  });

  test("lobby:opened drops the identity (the server wiped participants)", () => {
    const next = run({ ...joined(), status: "active", slide: liveSlide(), reveal }, event("lobby:opened", { joinCode: "1" }));
    expect(next).toMatchObject({ status: "lobby", currentSlideIndex: -1, slide: null, timing: null, reveal: null, me: null, self: null });
  });
});

describe("registerLiveReducer", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

  test("module state starts at its initial value and only reacts to what it handles", () => {
    cleanups.push(
      registerLiveReducer<{ count: number }>("qna", (state, action) =>
        isModuleEvent(action, "qna") ? { count: state.count + 1 } : state,
        { count: 0 }
      )
    );
    const state = createInitialLiveState("participant");
    expect(state.modules.qna).toEqual({ count: 0 });

    const afterQna = run(state, event("qna:question", {}), event("qna:votes", {}));
    expect(afterQna.modules.qna).toEqual({ count: 2 });

    // Unrelated actions keep both the module slice and the root state identity.
    expect(liveReducer(afterQna, event("reaction:burst", {}))).toBe(afterQna);
  });

  test("module reducers see core changes through `root` and module actions by prefix", () => {
    cleanups.push(
      registerLiveReducer<string[]>("log", (state, action, root) => {
        if (action.type === "live/module" && action.prefix === "log") return [...state, `${action.name}@${root.status}`];
        return state;
      }, [])
    );
    const next = run(
      createInitialLiveState("participant", { status: "lobby" }),
      { type: "live/module", prefix: "log", name: "hello" },
      { type: "live/module", prefix: "other", name: "ignored" }
    );
    expect(next.modules.log).toEqual(["hello@lobby"]);
  });

  test("reset restores every module's initial state", () => {
    cleanups.push(registerLiveReducer("counter", (state: number, action) => (isModuleEvent(action, "counter") ? state + 1 : state), 0));
    const bumped = liveReducer(createInitialLiveState("participant"), event("counter:tick", {}));
    expect(bumped.modules.counter).toBe(1);
    expect(liveReducer(bumped, { type: "live/reset", role: "participant" }).modules.counter).toBe(0);
  });

  test("re-registering a prefix replaces it; the old unregister is then a no-op", () => {
    const first = registerLiveReducer("dup", (s: number) => s + 1, 0);
    const second = registerLiveReducer("dup", (s: number) => s + 10, 0);
    cleanups.push(second);
    first();
    expect(liveReducer(createInitialLiveState("host"), { type: "live/connection", connected: true }).modules.dup).toBe(10);
  });

  test("rejects reserved and malformed prefixes", () => {
    expect(() => registerLiveReducer("live", (s) => s, null)).toThrow();
    expect(() => registerLiveReducer("host", (s) => s, null)).toThrow();
    expect(() => registerLiveReducer("Q&A", (s) => s, null)).toThrow();
  });
});
