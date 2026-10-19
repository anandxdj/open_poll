import { afterEach, describe, expect, test } from "bun:test";

import {
  classifySeq,
  createInitialLiveState,
  isModuleEvent,
  liveReducer,
  planEnvelope,
  registerLiveReducer,
  type LiveState,
} from "@/features/presentations/live/reducer";
import type { HostCommandResponse } from "@/features/presentations/types";
import {
  PID,
  SELF,
  SID,
  SID2,
  SLIDE_IDS,
  T0,
  at,
  deck,
  distribution,
  event,
  headingSlide,
  hostState,
  liveSlide,
  liveState,
  lobbySession,
  results,
  run,
  sessionView,
  standings,
} from "./live.fixtures";

// The live state machine: REST snapshots, host command responses and v1
// envelopes in, one state out. Host and participant share the session /
// phase / timing model, so most cases below exist in both halves.

/** The host console after loading host state of `session` (client clock = server clock). */
const hostAt = (
  session: ReturnType<typeof sessionView> | null,
  extra: Parameters<typeof hostState>[1] = {}
): LiveState =>
  liveReducer(createInitialLiveState("host", { presentationId: PID }), {
    type: "host/state-loaded",
    state: hostState(session, extra),
    receivedAt: T0 + 1000,
  });

const participantIn = (init: Partial<LiveState> = {}): LiveState =>
  createInitialLiveState("participant", {
    presentationId: PID,
    sessionId: SID,
    self: SELF,
    totalSlides: 3,
    status: "lobby",
    ...init,
  });

const started = (slideIndex: number, extra: Record<string, unknown> = {}) => ({
  slideId: SLIDE_IDS[slideIndex],
  slideIndex,
  slide: liveSlide({ slideIndex }),
  startedAt: at(40),
  endsAt: at(70),
  serverNow: at(40),
  isLastSlide: false,
  reopened: false,
  slideTicket: "st1.ticket-a",
  ...extra,
});

const revealedPayload = (extra: Record<string, unknown> = {}) => ({
  slideId: SLIDE_IDS[0],
  slideIndex: 0,
  slide: liveSlide(),
  question: "Q?",
  type: "select_answer",
  scored: true,
  distribution,
  answeredCount: 1,
  participantCount: 2,
  isLastSlide: false,
  auto: false,
  revealedAt: at(31),
  revisit: false,
  ...extra,
});

describe("liveReducer — core", () => {
  test("reset gives a fresh state for the role, keeping presentationId and self", () => {
    const dirty = { ...createInitialLiveState("host"), answeredCount: 4, title: "x", sessionId: SID };
    const next = liveReducer(dirty, { type: "live/reset", role: "participant", presentationId: PID, self: SELF });
    expect(next).toEqual(createInitialLiveState("participant", { presentationId: PID, self: SELF }));
  });

  test("connection only changes state when the value changes", () => {
    const state = createInitialLiveState("host");
    expect(liveReducer(state, { type: "live/connection", connected: false })).toBe(state);
    expect(liveReducer(state, { type: "live/connection", connected: true }).connected).toBe(true);
  });

  test("unknown event types leave the state untouched", () => {
    const host = createInitialLiveState("host", { sessionId: SID });
    const participant = createInitialLiveState("participant", { sessionId: SID });
    expect(liveReducer(host, event("qna:question", {}))).toBe(host);
    expect(liveReducer(participant, event("qna:question", {}))).toBe(participant);
  });

  test("never mutates its input", () => {
    const frozen = Object.freeze({ ...participantIn(), participants: Object.freeze([]) as never }) as LiveState;
    expect(() =>
      run(
        frozen,
        event("participant:joined", { participantId: "p2", name: "Grace", participantCount: 2 }),
        event("question:started", started(0))
      )
    ).not.toThrow();
  });
});

describe("envelopes — session scoping and seq", () => {
  test("an envelope of another session only records its seq", () => {
    const state = participantIn({ status: "active", slideId: SLIDE_IDS[0], phase: "open" });
    const next = liveReducer(state, event("session:ended", { leaderboard: standings }, { sessionId: SID2, seq: 7 }));
    expect(next.lastSeq).toBe(7);
    expect({ ...next, lastSeq: null }).toEqual({ ...state, lastSeq: null });
  });

  test("envelopes without a session id apply to the followed session", () => {
    const next = liveReducer(participantIn(), event("session:lobby", { runNumber: 1, joinCode: "999999", pace: "presenter" }, { sessionId: null }));
    expect(next.joinCode).toBe("999999");
  });

  test("a host that follows no session treats every session's envelope as foreign", () => {
    const state = hostAt(null);
    expect(state.sessionId).toBeNull();
    const next = liveReducer(state, event("session:lobby", { runNumber: 1, joinCode: "123456", pace: "presenter" }, { seq: 1 }));
    expect(next.status).toBe("draft");
    expect(next.lastSeq).toBe(1);
  });

  test("the latest seq is kept for gap detection", () => {
    const state = run(
      participantIn(),
      event("participant:joined", { participantId: "p2", name: "Grace", participantCount: 2 }, { seq: 4 }),
      event("participant:joined", { participantId: "p3", name: "Lin", participantCount: 3 }, { seq: 5 })
    );
    expect(state.lastSeq).toBe(5);
  });

  test("classifySeq", () => {
    expect(classifySeq(null, 3)).toBe("first");
    expect(classifySeq(3, 4)).toBe("next");
    expect(classifySeq(3, 6)).toBe("gap");
    expect(classifySeq(3, 3)).toBe("duplicate");
    expect(classifySeq(3, 1)).toBe("reset");
    expect(classifySeq(3, undefined)).toBe("next");
  });

  test("planEnvelope: the host resyncs on a gap, a participant does not (seq spans audiences)", () => {
    const host = { role: "host" as const, sessionId: SID, lastSeq: 10 };
    const participant = { role: "participant" as const, sessionId: SID, lastSeq: 10 };
    const envelope = (seq: number, sessionId: string | null = SID) =>
      (event("slide:shown", {}, { seq, sessionId }) as Extract<ReturnType<typeof event>, { type: "live/event" }>).event;

    expect(planEnvelope(host, envelope(11))).toEqual({ kind: "apply", resync: null });
    expect(planEnvelope(host, envelope(13))).toEqual({ kind: "apply", resync: "gap" });
    expect(planEnvelope(participant, envelope(13))).toEqual({ kind: "apply", resync: null });
    expect(planEnvelope(host, envelope(10))).toEqual({ kind: "duplicate" });
    expect(planEnvelope(host, envelope(4))).toEqual({ kind: "apply", resync: "reset" });
    expect(planEnvelope(participant, envelope(4))).toEqual({ kind: "apply", resync: "reset" });
    expect(planEnvelope(host, envelope(11, SID2))).toEqual({ kind: "foreign" });
    expect(planEnvelope({ ...host, lastSeq: null }, envelope(500))).toEqual({ kind: "apply", resync: null });
  });
});

describe("host — host state (mount, resync)", () => {
  test("a deck that was never presented: nothing is opened, the console offers to start", () => {
    const next = hostAt(null);
    expect(next).toMatchObject({
      status: "draft",
      sessionId: null,
      title: "Deck",
      joinCode: "123456",
      totalSlides: 3,
      currentSlideIndex: -1,
      slideId: null,
      phase: null,
      timing: null,
      participants: [],
      results: {},
    });
    expect(next.deck?.slides).toHaveLength(3);
  });

  test("a lobby is shown as it is, with the people already in it", () => {
    const next = hostAt(lobbySession());
    expect(next).toMatchObject({ status: "lobby", sessionId: SID, runNumber: 1, currentSlideIndex: -1, slideId: null, phase: null, timing: null });
    expect(next.participants.map((p) => p.name)).toEqual(["Ada", "Grace"]);
  });

  test("removed participants are left out", () => {
    const next = hostAt(lobbySession(), {
      participants: [
        { participantId: "p1", name: "Ada", kicked: false },
        { participantId: "p2", name: "Grace", kicked: true },
      ],
    });
    expect(next.participants.map((p) => p.name)).toEqual(["Ada"]);
  });

  test("a live session resumes where it is: slide, phase, timer, answers, results of visited slides", () => {
    const next = hostAt(sessionView(), {
      answeredCount: 2,
      liveDistribution: distribution,
      distributions: { [SLIDE_IDS[0]]: results({ answeredCount: 2 }) },
      leaderboard: standings,
    });
    expect(next).toMatchObject({
      status: "active",
      sessionId: SID,
      currentSlideIndex: 0,
      slideId: SLIDE_IDS[0],
      phase: "open",
      isLastSlide: false,
      answeredCount: 2,
      distribution,
      leaderboard: standings,
      reveal: null,
    });
    expect(next.timing).toEqual({ startedAt: at(0), endsAt: at(30), clockOffsetMs: 0 });
    expect(next.results[SLIDE_IDS[0]]?.answeredCount).toBe(2);
  });

  test("the clock offset comes from the host state's own serverNow", () => {
    // The browser's clock is 5 s behind the server: the response arrived at T0+1 s − 5 s.
    const next = liveReducer(createInitialLiveState("host", { presentationId: PID }), {
      type: "host/state-loaded",
      state: hostState(sessionView()),
      receivedAt: T0 + 1000 - 5000,
    });
    expect(next.clockOffsetMs).toBe(5000);
    expect(next.timing?.clockOffsetMs).toBe(5000);
  });

  test("an untimed open slide has no deadline", () => {
    const next = hostAt(sessionView({}, { endsAt: null }));
    expect(next.phase).toBe("open");
    expect(next.timing).toEqual({ startedAt: at(0), endsAt: null, clockOffsetMs: 0 });
  });

  test("a closed slide keeps its answers but has no running timer or reveal", () => {
    const next = hostAt(sessionView({}, { phase: "closed", closedAt: at(12), answeredCount: 2 }), {
      answeredCount: 2,
      liveDistribution: distribution,
      distributions: { [SLIDE_IDS[0]]: results({ answeredCount: 2 }) },
    });
    expect(next).toMatchObject({ phase: "closed", timing: null, reveal: null, distribution, answeredCount: 2 });
  });

  test("a revealed slide comes back with its stored results", () => {
    const next = hostAt(sessionView({}, { phase: "revealed", closedAt: at(30), revealedAt: at(31) }), {
      distributions: { [SLIDE_IDS[0]]: results() },
    });
    expect(next.phase).toBe("revealed");
    expect(next.timing).toBeNull();
    expect(next.reveal).toMatchObject({ slideIndex: 0, question: "Q?", type: "select_answer", answeredCount: 1, participantCount: 2, distribution });
  });

  test("a content slide is simply shown", () => {
    const next = hostAt(
      sessionView(
        { currentSlideId: SLIDE_IDS[1], currentSlideIndex: 1 },
        { slideId: SLIDE_IDS[1], slideIndex: 1, type: "heading", lifecycle: "content", scored: false, phase: "shown", endsAt: null, answeredCount: 0 }
      )
    );
    expect(next).toMatchObject({ currentSlideIndex: 1, phase: "shown", timing: null, reveal: null });
  });

  test("an ended session shows its final state, not a running one", () => {
    const next = hostAt(sessionView({ status: "ended", isLive: false, endedAt: at(99) }), { leaderboard: standings });
    expect(next).toMatchObject({ status: "ended", phase: null, timing: null, leaderboard: standings });
  });

  test("loading state of a new session drops the previous session's data", () => {
    const first = hostAt(sessionView(), { distributions: { [SLIDE_IDS[0]]: results() }, leaderboard: standings });
    const second = liveReducer(first, {
      type: "host/state-loaded",
      state: hostState(sessionView({ sessionId: SID2, runNumber: 2, status: "lobby", currentSlideId: null, currentSlideIndex: -1 }, null), {
        participants: [],
        answeredCount: 0,
      }),
      receivedAt: T0 + 2000,
    });
    expect(second).toMatchObject({ sessionId: SID2, runNumber: 2, status: "lobby", participants: [], results: {}, leaderboard: [], answeredCount: 0, distribution: null, reveal: null });
  });

  test("reloading the same session takes the server's numbers, however far local events ran ahead", () => {
    const state = run(hostAt(sessionView()), event("answer:received", { slideId: SLIDE_IDS[0], slideIndex: 0, answeredCount: 9, distribution }));
    expect(state.answeredCount).toBe(9);
    const next = liveReducer(state, { type: "host/state-loaded", state: hostState(sessionView(), { answeredCount: 10, liveDistribution: distribution }), receivedAt: T0 + 2000 });
    expect(next).toMatchObject({ answeredCount: 10, distribution });
  });

  test("the deck keeps the settings the stage reads (answer keys, config, points)", () => {
    const converted = {
      ...deck().slides[0],
      points: 0,
      options: [
        { text: "A", isCorrect: false },
        { text: "B", isCorrect: false },
      ],
      config: { allowMultiple: true, explanation: "Why" },
    };
    const next = liveReducer(createInitialLiveState("host"), {
      type: "host/state-loaded",
      state: hostState(null, { presentation: deck({ slides: [converted, { ...deck().slides[0], config: null }] }) }),
    });
    expect(next.deck?.slides[0]).toEqual(converted);
    expect(next.deck?.slides[1].config).toBeNull();
  });
});

describe("host — command responses", () => {
  const response = (session: ReturnType<typeof sessionView>): HostCommandResponse => ({ ...deck({ status: "active" }), session });

  test("start from a deck never presented follows the new session and its first slide", () => {
    const next = liveReducer(hostAt(null), { type: "host/command", response: response(sessionView({}, { answeredCount: 0 })) });
    expect(next).toMatchObject({ status: "active", sessionId: SID, currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "open", answeredCount: 0 });
    expect(next.timing?.endsAt).toBe(at(30));
  });

  test("present again after an ended session starts fresh: the first session's data is gone from the console", () => {
    const ended = hostAt(sessionView({ status: "ended", isLive: false }), { leaderboard: standings, distributions: { [SLIDE_IDS[0]]: results() } });
    const next = liveReducer(ended, {
      type: "host/command",
      response: response(sessionView({ sessionId: SID2, runNumber: 2 }, { answeredCount: 0 })),
    });
    expect(next).toMatchObject({ sessionId: SID2, runNumber: 2, status: "active", participants: [], leaderboard: [], results: {}, answeredCount: 0 });
  });

  test("goto a slide visited before shows its stored phase and results", () => {
    const onSecond = run(
      hostAt(sessionView(), { distributions: { [SLIDE_IDS[0]]: results() } }),
      { type: "host/command", response: response(sessionView({ currentSlideId: SLIDE_IDS[1], currentSlideIndex: 1 }, { slideId: SLIDE_IDS[1], slideIndex: 1, type: "heading", lifecycle: "content", scored: false, phase: "shown", endsAt: null })) }
    );
    expect(onSecond).toMatchObject({ currentSlideIndex: 1, phase: "shown", timing: null, distribution: null });

    const back = liveReducer(onSecond, {
      type: "host/command",
      response: response(sessionView({}, { phase: "revealed", closedAt: at(30), revealedAt: at(31), answeredCount: 1 })),
    });
    expect(back).toMatchObject({ currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "revealed", timing: null, distribution });
    expect(back.reveal).toMatchObject({ slideIndex: 0, answeredCount: 1, distribution });
  });

  test("close, then reopen, moves the slide through its phases", () => {
    const open = hostAt(sessionView({}, { endsAt: null }), { distributions: { [SLIDE_IDS[0]]: results() }, liveDistribution: distribution });
    const closed = liveReducer(open, { type: "host/command", response: response(sessionView({}, { endsAt: null, phase: "closed", closedAt: at(12) })) });
    expect(closed).toMatchObject({ phase: "closed", timing: null, distribution });
    const reopened = liveReducer(closed, { type: "host/command", response: response(sessionView({}, { endsAt: at(90), openedAt: at(60) })) });
    expect(reopened).toMatchObject({ phase: "open", timing: { startedAt: at(60), endsAt: at(90) }, distribution });
  });

  test("an answer count carried by an event that ran ahead of the response is kept", () => {
    const state = run(hostAt(sessionView({}, { answeredCount: 1 })), event("answer:received", { slideId: SLIDE_IDS[0], slideIndex: 0, answeredCount: 2 }));
    const next = liveReducer(state, { type: "host/command", response: response(sessionView({}, { answeredCount: 1 })) });
    expect(next.answeredCount).toBe(2);
  });

  test("end leaves the session ended", () => {
    const next = liveReducer(hostAt(sessionView()), { type: "host/command", response: response(sessionView({ status: "ended", isLive: false })) });
    expect(next).toMatchObject({ status: "ended", phase: null, timing: null });
  });
});

describe("host — events", () => {
  const active = () => hostAt(sessionView(), { distributions: { [SLIDE_IDS[0]]: results() } });

  test("participant:joined adds the person once", () => {
    const joined = event("participant:joined", { participantId: "p3", name: "Lin", participantCount: 3 });
    const next = run(hostAt(lobbySession()), joined, joined);
    expect(next.participants.map((p) => p.participantId)).toEqual(["p1", "p2", "p3"]);
  });

  test("session:lobby resets the console to a fresh lobby", () => {
    const next = liveReducer(active(), event("session:lobby", { runNumber: 1, joinCode: "654321", pace: "presenter" }));
    expect(next).toMatchObject({ status: "lobby", joinCode: "654321", currentSlideIndex: -1, slideId: null, phase: null, timing: null, reveal: null, distribution: null, answeredCount: 0 });
  });

  test("question:started opens the answer window with the offset of that event", () => {
    // The tab sat open for a minute; the client clock runs 3 s behind the server.
    const next = liveReducer(
      hostAt(lobbySession()),
      event("question:started", started(0, { serverNow: at(60), startedAt: at(60), endsAt: at(90) }), { receivedAt: T0 + 60_000 - 3000 })
    );
    expect(next).toMatchObject({ status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "open", reveal: null, answeredCount: 0, distribution: null });
    expect(next.timing).toEqual({ startedAt: at(60), endsAt: at(90), clockOffsetMs: 3000 });
    expect(next.clockOffsetMs).toBe(3000);
  });

  test("question:started with reopened keeps the answers already in", () => {
    const withAnswers = run(active(), event("answer:received", { slideId: SLIDE_IDS[0], slideIndex: 0, answeredCount: 4, distribution }));
    const next = liveReducer(withAnswers, event("question:started", started(0, { reopened: true, endsAt: null })));
    expect(next).toMatchObject({ phase: "open", answeredCount: 4, distribution, reveal: null });
    expect(next.timing?.endsAt).toBeNull();
  });

  test("slide:shown moves to a content slide with no answer window", () => {
    const next = liveReducer(active(), event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(40) }));
    expect(next).toMatchObject({ currentSlideIndex: 1, slideId: SLIDE_IDS[1], phase: "shown", timing: null, reveal: null, distribution: null, answeredCount: 0 });
  });

  test("slide:closed closes the window and keeps the results; a revisit shows the stored ones", () => {
    const closed = liveReducer(
      active(),
      event("slide:closed", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), closedAt: at(12), answeredCount: 2, participantCount: 2, isLastSlide: false, revisit: false, serverNow: at(12) })
    );
    expect(closed).toMatchObject({ phase: "closed", timing: null, answeredCount: 2, distribution });

    const away = liveReducer(closed, event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(20) }));
    const back = liveReducer(
      away,
      event("slide:closed", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), closedAt: at(12), answeredCount: 2, participantCount: 2, isLastSlide: false, revisit: true, serverNow: at(30) })
    );
    expect(back).toMatchObject({ currentSlideIndex: 0, phase: "closed", answeredCount: 2, distribution });
  });

  test("question:revealed stores the reveal and the results; a revisit restores them", () => {
    const revealed = liveReducer(active(), event("question:revealed", revealedPayload()));
    expect(revealed).toMatchObject({ phase: "revealed", timing: null, answeredCount: 1, distribution });
    expect(revealed.reveal).toEqual({ slideIndex: 0, question: "Q?", type: "select_answer", scored: true, distribution, answeredCount: 1, participantCount: 2, isLastSlide: false });
    expect(revealed.results[SLIDE_IDS[0]]).toMatchObject({ answeredCount: 1, distribution });

    const away = liveReducer(revealed, event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(40) }));
    expect(away.reveal).toBeNull();
    const back = liveReducer(away, event("question:revealed", revealedPayload({ revisit: true })));
    expect(back).toMatchObject({ currentSlideIndex: 0, phase: "revealed", distribution });
    expect(back.reveal?.answeredCount).toBe(1);
  });

  test("leaderboard:shown takes the standings", () => {
    const next = liveReducer(active(), event("leaderboard:shown", { slideId: SLIDE_IDS[2], slideIndex: 2, slide: liveSlide({ slideIndex: 2, type: "leaderboard" }), leaderboard: standings, participantCount: 2, isLastSlide: true }));
    expect(next).toMatchObject({ currentSlideIndex: 2, phase: "shown", leaderboard: standings, isLastSlide: true, timing: null });
  });

  test("session:ended ends it with the final standings", () => {
    const next = liveReducer(active(), event("session:ended", { runNumber: 1, endedAt: at(99), leaderboard: standings, participantCount: 2, answerCount: 1 }));
    expect(next).toMatchObject({ status: "ended", phase: null, timing: null, leaderboard: standings });
  });

  test("answer:received only ever raises the count of the slide on screen, and keeps the last distribution", () => {
    const first = liveReducer(active(), event("answer:received", { slideId: SLIDE_IDS[0], slideIndex: 0, answeredCount: 3, distribution }));
    expect(first).toMatchObject({ answeredCount: 3, distribution });
    const stale = liveReducer(first, event("answer:received", { slideId: SLIDE_IDS[0], slideIndex: 0, answeredCount: 2 }));
    expect(stale).toMatchObject({ answeredCount: 3, distribution });
  });

  test("answer:received for another slide updates that slide's results only", () => {
    const state = active();
    const next = liveReducer(state, event("answer:received", { slideId: SLIDE_IDS[1], slideIndex: 1, answeredCount: 5 }));
    expect(next.answeredCount).toBe(state.answeredCount);
    expect(next.results[SLIDE_IDS[1]]?.answeredCount).toBe(5);
  });

  test("the legacy copies lobby:opened and quiz:ended change nothing", () => {
    const state = active();
    expect(liveReducer(state, event("lobby:opened", { joinCode: "1" }))).toBe(state);
    expect(liveReducer(state, event("quiz:ended", { leaderboard: standings }))).toBe(state);
  });
});

describe("participant — code lookup and live-state", () => {
  const info = (extra: Record<string, unknown> = {}) => ({
    presentationId: PID,
    sessionId: SID,
    title: "Deck",
    status: "active" as const,
    totalSlides: 3,
    currentSlideIndex: 0,
    serverNow: at(10),
    currentSlide: liveSlide(),
    currentSlideId: SLIDE_IDS[0],
    currentSlidePhase: "open" as const,
    questionStartedAt: at(0),
    questionEndsAt: at(30),
    ...extra,
  });

  test("a late join renders the slide that is on screen, with the offset of that response", () => {
    const next = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: info(),
      receivedAt: T0 + 10_000 - 2000,
    });
    expect(next).toMatchObject({ presentationId: PID, sessionId: SID, title: "Deck", status: "active", slideId: SLIDE_IDS[0], phase: "open", slide: liveSlide(), currentSlideIndex: 0 });
    expect(next.timing).toEqual({ startedAt: at(0), endsAt: at(30), clockOffsetMs: 2000 });
  });

  test("a late join on a content slide gets the slide and no answer window", () => {
    const next = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: info({ currentSlide: headingSlide(), currentSlideId: SLIDE_IDS[1], currentSlideIndex: 1, currentSlidePhase: "shown", questionStartedAt: undefined, questionEndsAt: undefined }),
    });
    expect(next).toMatchObject({ phase: "shown", slide: headingSlide(), timing: null });
  });

  test("a late join on an untimed open slide has no deadline", () => {
    const next = liveReducer(createInitialLiveState("participant"), { type: "participant/info-loaded", info: info({ questionEndsAt: null }) });
    expect(next.timing?.endsAt).toBeNull();
  });

  test("a closed slide has no timer", () => {
    const next = liveReducer(createInitialLiveState("participant"), { type: "participant/info-loaded", info: info({ currentSlidePhase: "closed" }) });
    expect(next).toMatchObject({ phase: "closed", timing: null });
  });

  test("the lobby and the ended deck carry no slide", () => {
    const lobby = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: { presentationId: PID, sessionId: SID, title: "Deck", status: "lobby", totalSlides: 3, currentSlideIndex: -1, serverNow: at(0) },
    });
    expect(lobby).toMatchObject({ status: "lobby", slide: null, slideId: null, phase: null });
    const ended = liveReducer(lobby, {
      type: "participant/info-loaded",
      info: { presentationId: PID, sessionId: null, title: "Deck", status: "ended", totalSlides: 3, currentSlideIndex: 2, serverNow: at(0) },
    });
    expect(ended).toMatchObject({ status: "ended", sessionId: null, slide: null });
  });

  test("falls back to the legacy quizId", () => {
    const next = liveReducer(createInitialLiveState("participant"), {
      type: "participant/info-loaded",
      info: { quizId: PID, title: "Deck", status: "lobby", totalSlides: 2, currentSlideIndex: -1, serverNow: "" },
    });
    expect(next.presentationId).toBe(PID);
    expect(next.slide).toBeNull();
  });

  test("another session than the followed one resets everything of the old one, identity included", () => {
    const old = participantIn({ status: "ended", leaderboard: standings, me: { participantId: "p1" } as LiveState["me"] });
    const next = liveReducer(old, {
      type: "participant/info-loaded",
      info: { presentationId: PID, sessionId: SID2, title: "Deck", status: "lobby", totalSlides: 3, currentSlideIndex: -1, serverNow: at(0) },
    });
    expect(next).toMatchObject({ sessionId: SID2, status: "lobby", leaderboard: [], me: null, self: null });
  });

  test("credentials of the session can be handed in with the lookup", () => {
    const next = liveReducer(createInitialLiveState("participant"), { type: "participant/info-loaded", info: info(), self: SELF });
    expect(next.self).toEqual(SELF);
  });

  test("live-state of an open question restores slide, timer, own standing and 'answered'", () => {
    const next = liveReducer(participantIn(), {
      type: "participant/live-state",
      state: liveState({ me: { participantId: "p1", name: "Ada", totalScore: 700, correctCount: 1, rank: 2, answeredCurrent: true, lastAnswer: null } }),
      receivedAt: T0 + 10_000 - 1000,
    });
    expect(next).toMatchObject({ status: "active", phase: "open", slideId: SLIDE_IDS[0], currentSlideIndex: 0, submittedSlideIndex: 0 });
    expect(next.timing).toEqual({ startedAt: at(0), endsAt: at(30), clockOffsetMs: 1000 });
    expect(next.me).toMatchObject({ participantId: "p1", name: "Ada", totalScore: 700, rank: 2, sessionId: SID });
  });

  test("live-state of an open slide carries its ticket; closed and revealed slides have none", () => {
    const open = liveReducer(participantIn(), { type: "participant/live-state", state: liveState() });
    expect(open.slideTicket).toBe("st1.ticket-open");
    const closed = liveReducer(open, { type: "participant/live-state", state: liveState({}, { phase: "closed", slideTicket: null }) });
    expect(closed.slideTicket).toBeNull();
    const lobby = liveReducer(open, { type: "participant/live-state", state: liveState({ status: "lobby" }, null) });
    expect(lobby.slideTicket).toBeNull();
  });

  test("live-state of a not yet answered slide clears 'answered'", () => {
    const next = liveReducer(participantIn({ submittedSlideIndex: 0, slideId: SLIDE_IDS[0], currentSlideIndex: 0 }), {
      type: "participant/live-state",
      state: liveState(),
    });
    expect(next.submittedSlideIndex).toBeNull();
  });

  test("live-state of a revealed slide restores the results", () => {
    const next = liveReducer(participantIn(), {
      type: "participant/live-state",
      state: liveState({}, { phase: "revealed", results: results() }),
    });
    expect(next.phase).toBe("revealed");
    expect(next.timing).toBeNull();
    expect(next.reveal).toMatchObject({ slideIndex: 0, question: "Q?", answeredCount: 1, distribution });
  });

  test("live-state of a leaderboard slide synthesizes the slide and carries the standings", () => {
    const next = liveReducer(participantIn(), {
      type: "participant/live-state",
      state: liveState({}, { slideId: SLIDE_IDS[2], slideIndex: 2, phase: "shown", isLastSlide: true, slide: undefined as never, leaderboard: standings, startedAt: null, endsAt: null }),
    });
    expect(next.slide).toMatchObject({ type: "leaderboard", slideIndex: 2, totalSlides: 3 });
    expect(next).toMatchObject({ phase: "shown", leaderboard: standings, timing: null });
  });

  test("live-state of the lobby shows the lobby", () => {
    const next = liveReducer(participantIn({ status: "active", slideId: SLIDE_IDS[0], phase: "open" }), {
      type: "participant/live-state",
      state: liveState({ status: "lobby" }, null),
    });
    expect(next).toMatchObject({ status: "lobby", slideId: null, phase: null, slide: null, timing: null });
  });

  test("live-state of an ended session carries the final standings", () => {
    const next = liveReducer(participantIn(), {
      type: "participant/live-state",
      state: liveState({ status: "ended", finalLeaderboard: standings }, { phase: "closed" }),
    });
    expect(next).toMatchObject({ status: "ended", phase: null, timing: null, leaderboard: standings });
  });

  test("live-state of another session replaces the followed one", () => {
    const next = liveReducer(participantIn({ leaderboard: standings }), { type: "participant/live-state", state: liveState({ sessionId: SID2 }) });
    expect(next).toMatchObject({ sessionId: SID2, leaderboard: [] });
  });
});

describe("participant — events", () => {
  test("session:lobby returns to the lobby", () => {
    const state = participantIn({ status: "active", slideId: SLIDE_IDS[0], slide: liveSlide(), phase: "open", currentSlideIndex: 0, submittedSlideIndex: 0 });
    const next = liveReducer(state, event("session:lobby", { runNumber: 1, joinCode: "123456", pace: "presenter" }));
    expect(next).toMatchObject({ status: "lobby", slide: null, slideId: null, phase: null, currentSlideIndex: -1, submittedSlideIndex: null });
    expect(next.self).toEqual(SELF);
  });

  test("question:started shows the slide with the deadline and offset it arrived with", () => {
    // Waited in the lobby for a minute: the offset must come from this event.
    const next = liveReducer(
      participantIn({ me: { participantId: "p1" } as LiveState["me"], clockOffsetMs: 60_000 }),
      event("question:started", started(0, { serverNow: at(120), startedAt: at(120), endsAt: at(150) }), { receivedAt: T0 + 120_000 })
    );
    expect(next).toMatchObject({ status: "active", currentSlideIndex: 0, slideId: SLIDE_IDS[0], phase: "open", slide: liveSlide(), reveal: null, me: null, submittedSlideIndex: null });
    expect(next.timing).toEqual({ startedAt: at(120), endsAt: at(150), clockOffsetMs: 0 });
    expect(next.clockOffsetMs).toBe(0);
  });

  test("question:started with no deadline is an untimed window", () => {
    const next = liveReducer(participantIn(), event("question:started", started(0, { endsAt: null })));
    expect(next.timing?.endsAt).toBeNull();
    expect(next.phase).toBe("open");
  });

  test("question:started brings the slide ticket; a reopen replaces it; closing, leaving and ending drop it", () => {
    const open = run(participantIn(), event("question:started", started(0)));
    expect(open.slideTicket).toBe("st1.ticket-a");

    const closed = liveReducer(open, event("slide:closed", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), closedAt: at(50), answeredCount: 1, participantCount: 2, isLastSlide: false, revisit: false, serverNow: at(50) }));
    expect(closed.slideTicket).toBeNull();

    const reopened = liveReducer(closed, event("question:started", started(0, { reopened: true, slideTicket: "st1.ticket-b" })));
    expect(reopened.slideTicket).toBe("st1.ticket-b");

    expect(liveReducer(reopened, event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(60) })).slideTicket).toBeNull();
    expect(liveReducer(reopened, event("question:revealed", revealedPayload())).slideTicket).toBeNull();
    expect(liveReducer(reopened, event("session:ended", { runNumber: 1, endedAt: at(99), leaderboard: [], participantCount: 2, answerCount: 1 })).slideTicket).toBeNull();
    expect(liveReducer(reopened, event("session:lobby", { runNumber: 2, joinCode: "123456", pace: "presenter" })).slideTicket).toBeNull();
  });

  test("the ticket survives anything that leaves the same open window in place", () => {
    const open = run(participantIn(), event("question:started", started(0)));
    // Another envelope for the same slide, then the participant list changing.
    const next = run(open, event("participant:joined", { participantId: "p2", name: "Grace", participantCount: 2 }));
    expect(next.slideTicket).toBe("st1.ticket-a");
  });

  test("a multi-select slide arrives with allowMultiple; single-select slides keep their shape", () => {
    const multi = run(participantIn(), event("question:started", started(0, { slide: liveSlide({ allowMultiple: true }) })));
    expect(multi.slide?.allowMultiple).toBe(true);
    const single = run(participantIn(), event("question:started", started(0)));
    expect(single.slide).toEqual(liveSlide());
    expect("allowMultiple" in single.slide!).toBe(false);
  });

  test("slide:shown puts a content slide on the phone and clears the previous answer window", () => {
    const state = participantIn({ status: "active", slideId: SLIDE_IDS[0], currentSlideIndex: 0, phase: "open", slide: liveSlide(), submittedSlideIndex: 0, timing: { startedAt: at(0), endsAt: at(30), clockOffsetMs: 0 } });
    const next = liveReducer(state, event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(20) }));
    expect(next).toMatchObject({ status: "active", currentSlideIndex: 1, slideId: SLIDE_IDS[1], phase: "shown", slide: headingSlide(), timing: null, reveal: null, submittedSlideIndex: null });
  });

  test("slide:shown works for a participant who was still in the lobby", () => {
    const next = liveReducer(participantIn(), event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(20) }));
    expect(next).toMatchObject({ status: "active", phase: "shown", slide: headingSlide() });
  });

  test("slide:closed ends the answer window; a revisit lands on the slide in its closed phase", () => {
    const open = run(participantIn(), event("question:started", started(0)));
    const closed = liveReducer(open, event("slide:closed", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), closedAt: at(50), answeredCount: 1, participantCount: 2, isLastSlide: false, revisit: false, serverNow: at(50) }));
    expect(closed).toMatchObject({ phase: "closed", timing: null, slide: liveSlide() });

    const away = liveReducer(closed, event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(60) }));
    const back = liveReducer(away, event("slide:closed", { slideId: SLIDE_IDS[0], slideIndex: 0, slide: liveSlide(), closedAt: at(50), answeredCount: 1, participantCount: 2, isLastSlide: false, revisit: true, serverNow: at(70) }));
    expect(back).toMatchObject({ currentSlideIndex: 0, phase: "closed", slide: liveSlide(), submittedSlideIndex: null });
  });

  test("question:started reopened keeps 'answered' and the standing for those who already answered", () => {
    const answered = participantIn({ status: "active", slideId: SLIDE_IDS[0], currentSlideIndex: 0, phase: "closed", slide: liveSlide(), submittedSlideIndex: 0, me: { participantId: "p1" } as LiveState["me"] });
    const next = liveReducer(answered, event("question:started", started(0, { reopened: true })));
    expect(next).toMatchObject({ phase: "open", submittedSlideIndex: 0 });
    expect(next.me).toBe(answered.me);
  });

  test("question:revealed, also as a revisit, shows the results", () => {
    const open = run(participantIn(), event("question:started", started(0)));
    const revealed = liveReducer(open, event("question:revealed", revealedPayload()));
    expect(revealed).toMatchObject({ phase: "revealed", timing: null, slide: liveSlide() });
    expect(revealed.reveal).toMatchObject({ slideIndex: 0, answeredCount: 1, distribution });

    const away = liveReducer(revealed, event("slide:shown", { slideId: SLIDE_IDS[1], slideIndex: 1, slide: headingSlide(), isLastSlide: false, serverNow: at(60) }));
    const back = liveReducer(away, event("question:revealed", revealedPayload({ revisit: true })));
    expect(back).toMatchObject({ currentSlideIndex: 0, phase: "revealed" });
    expect(back.reveal?.distribution).toEqual(distribution);
  });

  test("leaderboard:shown swaps in a synthesized leaderboard slide", () => {
    const state = participantIn({ status: "active", slideId: SLIDE_IDS[0], currentSlideIndex: 0, phase: "revealed", reveal: { slideIndex: 0 } as LiveState["reveal"], timing: { startedAt: null, endsAt: null, clockOffsetMs: 0 } });
    const next = liveReducer(state, event("leaderboard:shown", { slideId: SLIDE_IDS[2], slideIndex: 2, leaderboard: standings, participantCount: 2, isLastSlide: true }));
    expect(next.slide).toMatchObject({ type: "leaderboard", slideIndex: 2, totalSlides: 3 });
    expect(next).toMatchObject({ phase: "shown", reveal: null, timing: null, leaderboard: standings, currentSlideIndex: 2, status: "active" });
  });

  test("session:ended ends the session with the final standings", () => {
    const next = liveReducer(participantIn({ status: "active" }), event("session:ended", { runNumber: 1, endedAt: at(99), leaderboard: standings, participantCount: 2, answerCount: 1 }));
    expect(next).toMatchObject({ status: "ended", phase: null, timing: null, leaderboard: standings });
  });

  test("participant:joined fills the lobby count source", () => {
    const next = liveReducer(participantIn(), event("participant:joined", { participantId: "p2", name: "Grace", participantCount: 2 }));
    expect(next.participants).toEqual([{ participantId: "p2", name: "Grace" }]);
  });

  test("the legacy copies lobby:opened and quiz:ended change nothing; answer:received never reaches a participant", () => {
    const state = participantIn({ status: "active" });
    expect(liveReducer(state, event("lobby:opened", { joinCode: "1" }))).toBe(state);
    expect(liveReducer(state, event("quiz:ended", { leaderboard: [] }))).toBe(state);
    expect(liveReducer(state, event("answer:received", { slideId: SLIDE_IDS[0], slideIndex: 0, answeredCount: 9 }))).toBe(state);
  });

  test("events of another session never touch a participant", () => {
    const state = participantIn({ status: "active" });
    const next = liveReducer(state, event("session:lobby", { runNumber: 2, joinCode: "123456", pace: "presenter" }, { sessionId: SID2 }));
    expect(next).toBe(state);
  });
});

describe("participant — identity and progress", () => {
  const me = { participantId: "p1", sessionId: SID, name: "Ada", totalScore: 900, correctCount: 1, rank: 1, quizStatus: "active" as const };

  test("joining follows the session the join response names", () => {
    const next = liveReducer(createInitialLiveState("participant", { sessionId: SID2, leaderboard: standings }), { type: "participant/joined", self: SELF, sessionId: SID });
    expect(next).toMatchObject({ self: SELF, sessionId: SID, lost: null, leaderboard: [] });
  });

  test("submitted and me-loaded record the participant's own progress", () => {
    const next = run(participantIn(), { type: "participant/submitted", slideIndex: 0 }, { type: "participant/me-loaded", me: { ...me, lastAnswer: null } });
    expect(next.submittedSlideIndex).toBe(0);
    expect(next.me).toMatchObject({ totalScore: 900 });
  });

  test("a last answer for the slide on screen marks it answered (revisit of an answered slide)", () => {
    const onSlide = participantIn({ status: "active", slideId: SLIDE_IDS[0], currentSlideIndex: 0, phase: "revealed" });
    const next = liveReducer(onSlide, { type: "participant/me-loaded", me: { ...me, lastAnswer: { slideId: SLIDE_IDS[0], slideIndex: 0, isCorrect: true, score: 900, scored: true } } });
    expect(next.submittedSlideIndex).toBe(0);
  });

  test("a last answer for another slide does not", () => {
    const onSlide = participantIn({ status: "active", slideId: SLIDE_IDS[1], currentSlideIndex: 1, phase: "closed" });
    const next = liveReducer(onSlide, { type: "participant/me-loaded", me: { ...me, lastAnswer: { slideId: SLIDE_IDS[0], slideIndex: 0, isCorrect: true, score: 900, scored: true } } });
    expect(next.submittedSlideIndex).toBeNull();
    expect(next.me?.totalScore).toBe(900);
  });

  test("a standing of another session is ignored", () => {
    const state = participantIn();
    expect(liveReducer(state, { type: "participant/me-loaded", me: { ...me, sessionId: SID2, lastAnswer: null } })).toBe(state);
  });

  test("lost credentials: kicked forgets the identity, stale and missing keep the screen but flag it", () => {
    const state = participantIn({ me: me as LiveState["me"], submittedSlideIndex: 0 });
    expect(liveReducer(state, { type: "participant/lost", reason: "kicked" })).toMatchObject({ lost: "kicked", self: null, me: null, submittedSlideIndex: null });
    expect(liveReducer(state, { type: "participant/lost", reason: "stale" })).toMatchObject({ lost: "stale", self: SELF });
    expect(liveReducer(state, { type: "participant/lost", reason: "missing" })).toMatchObject({ lost: "missing", self: SELF });
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
    const state = participantIn();
    expect(createInitialLiveState("participant").modules.qna).toEqual({ count: 0 });

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

  test("a module never sees another session's events", () => {
    cleanups.push(
      registerLiveReducer("qna2", (state: number, action) => (isModuleEvent(action, "qna2") ? state + 1 : state), 0)
    );
    const next = run(participantIn(), event("qna2:question", {}, { sessionId: SID2 }), event("qna2:question", {}));
    expect(next.modules.qna2).toBe(1);
  });

  test("reset restores every module's initial state", () => {
    cleanups.push(registerLiveReducer("counter", (state: number, action) => (isModuleEvent(action, "counter") ? state + 1 : state), 0));
    const bumped = liveReducer(participantIn(), event("counter:tick", {}));
    expect(bumped.modules.counter).toBe(1);
    expect(liveReducer(bumped, { type: "live/reset", role: "participant" }).modules.counter).toBe(0);
  });

  test("a new session restarts module state", () => {
    cleanups.push(registerLiveReducer("counter2", (state: number, action) => (isModuleEvent(action, "counter2") ? state + 1 : state), 0));
    const bumped = liveReducer(participantIn(), event("counter2:tick", {}));
    expect(bumped.modules.counter2).toBe(1);
    const next = liveReducer(bumped, { type: "participant/live-state", state: liveState({ sessionId: SID2 }) });
    expect(next.modules.counter2).toBe(0);
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
