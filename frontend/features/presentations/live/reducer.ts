import type {
  DeckSettings,
  HostCommandResponse,
  HostState,
  LeaderboardEntry,
  LiveParticipant,
  LiveSlide,
  ParticipantLiveState,
  ParticipantState,
  Presentation,
  PresentationRealtimeEvent,
  PresentationSlideType,
  PresentationStatus,
  PublicPresentationInfo,
  RevealDistribution,
  RevealPayload,
  SessionView,
  SlidePhase,
  SlideResultsView,
} from "../types";
import { isRealtimeEvent } from "../types/realtime";
import { clockOffsetFrom } from "./clock";

/**
 * Pure state machine behind every live surface (host console, participant
 * shell, and later the presenter/screen views). REST snapshots, command
 * responses and socket envelopes go in as actions; side effects (fetches,
 * storage, toasts, resyncs) stay in the hooks and components that dispatch
 * them.
 *
 * A surface follows one **session** (`sessionId`): envelopes of another
 * session are dropped (only their `seq` is recorded). Feature modules add
 * their own state through `registerLiveReducer(prefix, fn)`; see
 * `docs/wiki/features/live-surfaces.md`.
 */

export type LiveRole = "host" | "participant";

export interface LiveSelf {
  participantId: string;
  name: string;
  token: string;
}

export type ParticipantLostReason = "kicked" | "stale" | "missing";

export interface LiveTiming {
  /** When the answer window opened (server clock). */
  startedAt: string | null;
  /** Deadline (server clock); null = untimed, open until the host closes it. */
  endsAt: string | null;
  /**
   * Server clock minus client clock (ms), measured when this window arrived:
   * from the `serverNow` of the same event or REST response, else the latest
   * sample (`LiveState.clockOffsetMs`).
   */
  clockOffsetMs: number;
}

export interface LiveState {
  role: LiveRole;
  presentationId: string | null;
  connected: boolean;
  /** The session this surface follows: host — the live (else latest) one; participant — the one joined. */
  sessionId: string | null;
  runNumber: number | null;
  /** `draft` (host only): the deck has never been presented. */
  status: PresentationStatus | null;
  title: string;
  joinCode: string;
  totalSlides: number;
  currentSlideIndex: number;
  /** Id of the current slide (session-scoped; stable within a session). */
  slideId: string | null;
  /** Phase of the current slide; null in the lobby and once ended. */
  phase: SlidePhase | null;
  isLastSlide: boolean;
  /** Host only: the full deck, answer keys included. */
  deck: Presentation | null;
  /** Participant: the slide on screen, sanitized (any lifecycle). */
  slide: LiveSlide | null;
  /** The open answer window of the current slide; null unless `phase === "open"`. */
  timing: LiveTiming | null;
  /** Participant: proof the window was seen open, sent with answers; null unless `phase === "open"`. */
  slideTicket: string | null;
  /** Latest server-minus-client clock sample (ms); null until a `serverNow` arrived. */
  clockOffsetMs: number | null;
  /** Revealed results of the current slide. */
  reveal: RevealPayload | null;
  /** Host only: the current slide's distribution, whatever its phase (`answer:received` is host-only). */
  distribution: RevealDistribution | null;
  answeredCount: number;
  participants: LiveParticipant[];
  leaderboard: LeaderboardEntry[];
  /** Host only: results of every visited response slide, by slideId (revisits show them). */
  results: Record<string, SlideResultsView>;
  /** Participant: the session's settings snapshot (from `live-state`). */
  settings: DeckSettings | null;
  /** Participant identity once joined. */
  self: LiveSelf | null;
  /** Participant: own score/rank/last answer. */
  me: ParticipantState | null;
  /** Participant: index of the slide this participant answered (current slide only). */
  submittedSlideIndex: number | null;
  /**
   * Participant: why the credentials stopped working — `kicked` (removed by
   * the host), `stale` (they belong to an ended session), `missing` (unknown
   * participant). The shell reacts (kicked screen, or rejoin).
   */
  lost: ParticipantLostReason | null;
  /** Highest envelope `seq` seen for this deck (any session); null before the first event. */
  lastSeq: number | null;
  /** Sub-reducer state, keyed by the prefix the module registered with. */
  modules: Record<string, unknown>;
}

export type LiveAction =
  | { type: "live/reset"; role: LiveRole; presentationId?: string | null; self?: LiveSelf | null }
  | { type: "live/connection"; connected: boolean }
  /** `receivedAt` (client ms) dates the event's `serverNow` for the clock offset. */
  | { type: "live/event"; event: PresentationRealtimeEvent; receivedAt?: number }
  /** A feature module's own action; only its sub-reducer gives it meaning. */
  | { type: "live/module"; prefix: string; name: string; payload?: unknown }
  /** `GET /:id/host/state` (mount, reconnect, resync). */
  | { type: "host/state-loaded"; state: HostState; receivedAt?: number }
  /** The response of any host command (`open-lobby`, `start`, `goto`, `close`, `reopen`, `reveal`, `end`). */
  | { type: "host/command"; response: HostCommandResponse }
  /**
   * `GET /code/:code`. `self` (with `sessionId`) when stored credentials of
   * that session exist; a different session than the one followed resets the
   * session-scoped state.
   */
  | { type: "participant/info-loaded"; info: PublicPresentationInfo; self?: LiveSelf | null; sessionId?: string | null; receivedAt?: number }
  | { type: "participant/joined"; self: LiveSelf; sessionId: string }
  /** `GET /:id/live-state` (after joining, reconnect, resync). */
  | { type: "participant/live-state"; state: ParticipantLiveState; receivedAt?: number }
  | { type: "participant/me-loaded"; me: ParticipantState }
  | { type: "participant/submitted"; slideIndex: number }
  /** The credentials stopped working; `kicked` also forgets the identity. */
  | { type: "participant/lost"; reason: ParticipantLostReason };

export function createInitialLiveState(
  role: LiveRole = "participant",
  init: Partial<LiveState> = {}
): LiveState {
  return {
    role,
    presentationId: null,
    connected: false,
    sessionId: null,
    runNumber: null,
    status: null,
    title: "",
    joinCode: "",
    totalSlides: 0,
    currentSlideIndex: -1,
    slideId: null,
    phase: null,
    isLastSlide: false,
    deck: null,
    slide: null,
    timing: null,
    slideTicket: null,
    clockOffsetMs: null,
    reveal: null,
    distribution: null,
    answeredCount: 0,
    participants: [],
    leaderboard: [],
    results: {},
    settings: null,
    self: null,
    me: null,
    submittedSlideIndex: null,
    lost: null,
    lastSeq: null,
    modules: initialModuleState(),
    ...init,
  };
}

// ---------- Module sub-reducers ----------

/**
 * A feature module's slice of live state. It sees every action (core and
 * module) of the followed session, after the core reducer ran, and must return
 * its slice unchanged (same reference) when the action is not its business.
 */
export type LiveSubReducer<S = unknown> = (state: S, action: LiveAction, root: LiveState) => S;

interface ModuleEntry {
  reduce: LiveSubReducer<unknown>;
  initialState: unknown;
}

const PREFIX_RE = /^[a-z][a-z0-9-]*$/;
const RESERVED_PREFIXES = new Set(["live", "host", "participant"]);
const moduleReducers = new Map<string, ModuleEntry>();

/**
 * Registers a module's sub-reducer. `prefix` names both its state slice
 * (`state.modules[prefix]`) and its realtime event types (`<prefix>:*`).
 * Re-registering a prefix replaces it (hot reload). Returns an unregister fn.
 */
export function registerLiveReducer<S>(
  prefix: string,
  reduce: LiveSubReducer<S>,
  initialState: S
): () => void {
  if (!PREFIX_RE.test(prefix) || RESERVED_PREFIXES.has(prefix)) {
    throw new Error(`registerLiveReducer: invalid prefix "${prefix}"`);
  }
  const entry: ModuleEntry = { reduce: reduce as LiveSubReducer<unknown>, initialState };
  moduleReducers.set(prefix, entry);
  return () => {
    if (moduleReducers.get(prefix) === entry) moduleReducers.delete(prefix);
  };
}

/** True when `event` belongs to the module registered under `prefix`. */
export const isModuleEvent = (action: LiveAction, prefix: string) =>
  action.type === "live/event" && action.event.type.startsWith(`${prefix}:`);

function initialModuleState(): Record<string, unknown> {
  const modules: Record<string, unknown> = {};
  for (const [prefix, entry] of moduleReducers) modules[prefix] = entry.initialState;
  return modules;
}

function reduceModules(state: LiveState, action: LiveAction): LiveState {
  if (moduleReducers.size === 0) return state;
  let modules: Record<string, unknown> | null = null;
  for (const [prefix, entry] of moduleReducers) {
    const prev = prefix in state.modules ? state.modules[prefix] : entry.initialState;
    const next = entry.reduce(prev, action, state);
    if (next !== state.modules[prefix]) {
      modules ??= { ...state.modules };
      modules[prefix] = next;
    }
  }
  return modules ? { ...state, modules } : state;
}

// ---------- Sessions and seq ----------

/** True when `event` belongs to the session `state` follows (or to no session at all). */
export const isOwnSessionEvent = (state: Pick<LiveState, "sessionId">, event: PresentationRealtimeEvent) =>
  !event.sessionId || event.sessionId === state.sessionId;

export type SeqVerdict = "first" | "next" | "gap" | "duplicate" | "reset";

/**
 * Where an envelope's `seq` sits against the last one seen. `seq` is one
 * per-deck counter across audiences and sessions: `gap` means events were
 * missed — certain for the host (it receives every `all` and `host` event),
 * normal for a participant (host-only events consume numbers too). `reset`
 * (lower than seen) means the counter restarted or the stream is out of
 * order. Either way a resync recovers the state.
 */
export function classifySeq(lastSeq: number | null, seq: number | undefined): SeqVerdict {
  if (typeof seq !== "number") return "next";
  if (lastSeq === null) return "first";
  if (seq === lastSeq + 1) return "next";
  if (seq > lastSeq) return "gap";
  if (seq === lastSeq) return "duplicate";
  return "reset";
}

/** What a surface does with one incoming envelope. */
export type EnvelopePlan =
  /** Another session's: only its `seq` is recorded; the surface may want to look at which session is live. */
  | { kind: "foreign" }
  /** Same `seq` as the last one: already applied. */
  | { kind: "duplicate" }
  /** Apply it; `resync` (to run first, so the store replays the event on top) when the stream is untrustworthy. */
  | { kind: "apply"; resync: "gap" | "reset" | null };

/**
 * Decides how to treat an envelope: foreign sessions are set aside, a repeated
 * `seq` is dropped, `reset` (lower `seq`) always asks for a resync, and a `gap`
 * does only for the host — it receives every `all` and `host` event, so a skip
 * is a lost event. For a participant a gap is normal (host-only events and
 * other participants' events use numbers too); it recovers on reconnect.
 */
export function planEnvelope(
  state: Pick<LiveState, "role" | "sessionId" | "lastSeq">,
  event: PresentationRealtimeEvent
): EnvelopePlan {
  if (!isOwnSessionEvent(state, event)) return { kind: "foreign" };
  const verdict = classifySeq(state.lastSeq, event.seq);
  if (verdict === "duplicate") return { kind: "duplicate" };
  if (verdict === "reset") return { kind: "apply", resync: "reset" };
  return { kind: "apply", resync: verdict === "gap" && state.role === "host" ? "gap" : null };
}

const withSeq = (state: LiveState, event: PresentationRealtimeEvent): LiveState =>
  typeof event.seq === "number" && event.seq !== state.lastSeq ? { ...state, lastSeq: event.seq } : state;

/** Everything that belongs to one session; cleared when the followed session changes. */
const sessionScoped = (): Partial<LiveState> => ({
  runNumber: null,
  currentSlideIndex: -1,
  slideId: null,
  phase: null,
  isLastSlide: false,
  slide: null,
  timing: null,
  slideTicket: null,
  reveal: null,
  distribution: null,
  answeredCount: 0,
  participants: [],
  leaderboard: [],
  results: {},
  me: null,
  submittedSlideIndex: null,
  modules: initialModuleState(),
});

/** Moves to another session (or none): resets the session-scoped state. No-op for the same session. */
const followSession = (state: LiveState, sessionId: string | null): LiveState =>
  state.sessionId === sessionId ? state : { ...state, ...sessionScoped(), sessionId };

// ---------- Core reducer ----------

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  // Another session's envelope: record its seq, nothing else sees it.
  if (action.type === "live/event" && !isOwnSessionEvent(state, action.event)) {
    return withSeq(state, action.event);
  }
  return reduceModules(coreReducer(state, action), action);
}

const offsetOr = (state: LiveState, serverNow: string | null | undefined, receivedAt: number | undefined) =>
  clockOffsetFrom(serverNow, receivedAt) ?? state.clockOffsetMs;

/** Participants get no slide payload for a leaderboard slide; the shell renders it by type. */
export const leaderboardSlide = (slideIndex: number, totalSlides: number): LiveSlide => ({
  slideIndex,
  totalSlides,
  type: "leaderboard",
  scored: false,
  question: "",
  options: [],
  statements: [],
  minLabel: "",
  maxLabel: "",
  scaleMax: 5,
  items: [],
  maxEntries: 3,
  timeLimit: 0,
  points: 0,
  scoreDependsOnTime: false,
});

/** A reveal payload from stored results (host state, live-state, revisits). */
export const revealFromResults = (
  results: SlideResultsView,
  question: string,
  isLastSlide: boolean
): RevealPayload => ({
  slideIndex: results.slideIndex,
  question,
  type: results.type as PresentationSlideType,
  scored: results.scored,
  distribution: results.distribution,
  answeredCount: results.answeredCount,
  participantCount: results.participantCount,
  isLastSlide,
});

interface SlidePosition {
  slideId: string;
  slideIndex: number;
  isLastSlide: boolean;
  phase: SlidePhase;
}

/** Makes a slide current. Leaving a slide drops its per-slide state. */
function atSlide(state: LiveState, at: SlidePosition): LiveState {
  const sameSlide = state.slideId === at.slideId && state.currentSlideIndex === at.slideIndex;
  return {
    ...state,
    status: "active",
    currentSlideIndex: at.slideIndex,
    slideId: at.slideId,
    isLastSlide: at.isLastSlide,
    phase: at.phase,
    timing: at.phase === "open" && sameSlide ? state.timing : null,
    slideTicket: at.phase === "open" && sameSlide ? state.slideTicket : null,
    reveal: at.phase === "revealed" && sameSlide ? state.reveal : null,
    submittedSlideIndex: sameSlide ? state.submittedSlideIndex : null,
  };
}

function coreReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "live/reset":
      return createInitialLiveState(action.role, {
        presentationId: action.presentationId ?? null,
        self: action.self ?? null,
      });

    case "live/connection":
      return state.connected === action.connected ? state : { ...state, connected: action.connected };

    case "live/event": {
      const next = withSeq(state, action.event);
      return state.role === "host"
        ? hostEvent(next, action.event, action.receivedAt)
        : participantEvent(next, action.event, action.receivedAt);
    }

    case "live/module":
      return state;

    case "host/state-loaded":
      return hostStateLoaded(state, action.state, action.receivedAt);

    case "host/command":
      return hostCommand(state, action.response);

    case "participant/info-loaded":
      return participantInfoLoaded(state, action);

    case "participant/joined": {
      const next = followSession(state, action.sessionId);
      return { ...next, self: action.self, lost: null };
    }

    case "participant/live-state":
      return participantLiveState(state, action.state, action.receivedAt);

    case "participant/me-loaded": {
      if (action.me.sessionId && state.sessionId && action.me.sessionId !== state.sessionId) return state;
      // `lastAnswer` is this participant's answer to the slide on screen once it
      // stopped accepting answers: after a revisit it is how "answered" is known.
      const last = action.me.lastAnswer;
      const answeredHere =
        last !== null &&
        state.slideId !== null &&
        (last.slideId !== undefined ? last.slideId === state.slideId : last.slideIndex === state.currentSlideIndex);
      return {
        ...state,
        me: action.me,
        submittedSlideIndex: answeredHere ? state.currentSlideIndex : state.submittedSlideIndex,
      };
    }

    case "participant/submitted":
      return { ...state, submittedSlideIndex: action.slideIndex };

    case "participant/lost":
      return action.reason === "kicked"
        ? { ...state, lost: action.reason, self: null, me: null, submittedSlideIndex: null }
        : { ...state, lost: action.reason };

    default:
      return state;
  }
}

// ---------- Host ----------

const deckOf = (response: HostCommandResponse): Presentation => {
  const { session: _session, ...deck } = response;
  void _session;
  return deck as Presentation;
};

/** Status, current slide, phase and timing from a session view (host state and command responses). */
function applySessionView(
  state: LiveState,
  session: SessionView,
  clockOffsetMs: number | null
): LiveState {
  const current = session.current;
  const next: LiveState = {
    ...state,
    runNumber: session.runNumber,
    status: session.status,
    joinCode: session.joinCode || state.joinCode,
    totalSlides: session.totalSlides,
    currentSlideIndex: session.currentSlideIndex,
    slideId: session.currentSlideId,
    phase: session.status === "active" ? (current?.phase ?? null) : null,
    isLastSlide: current?.isLastSlide ?? false,
    timing:
      session.status === "active" && current?.phase === "open"
        ? { startedAt: current.openedAt, endsAt: current.endsAt, clockOffsetMs: clockOffsetMs ?? 0 }
        : null,
  };
  const results = next.slideId ? next.results[next.slideId] : undefined;
  const question = next.deck?.slides[next.currentSlideIndex]?.question ?? "";
  next.distribution = results?.distribution ?? null;
  next.reveal = next.phase === "revealed" && results ? revealFromResults(results, question, next.isLastSlide) : null;
  return next;
}

function hostStateLoaded(state: LiveState, host: HostState, receivedAt: number | undefined): LiveState {
  const deck = host.presentation ?? host.quiz;
  if (!deck) return state;
  const clockOffsetMs = offsetOr(state, host.serverNow, receivedAt);
  const base: LiveState = {
    ...followSession(state, host.session?.sessionId ?? null),
    presentationId: state.presentationId ?? deck._id,
    deck,
    title: deck.title,
    joinCode: deck.joinCode,
    totalSlides: deck.slides.length,
    clockOffsetMs,
  };
  if (!host.session) return { ...base, ...sessionScoped(), status: "draft", modules: base.modules };

  const withData: LiveState = {
    ...base,
    participants: host.participants.filter((p) => !p.kicked),
    leaderboard: host.leaderboard ?? [],
    results: host.distributions ?? {},
  };
  const next = applySessionView(withData, host.session, clockOffsetMs);
  return {
    ...next,
    answeredCount: host.answeredCount,
    distribution: host.liveDistribution ?? next.distribution,
  };
}

function hostCommand(state: LiveState, response: HostCommandResponse): LiveState {
  const deck = deckOf(response);
  const session = response.session;
  const sameSlide = state.sessionId === session.sessionId && state.slideId === session.currentSlideId;
  const base: LiveState = {
    ...followSession(state, session.sessionId),
    deck,
    title: deck.title,
  };
  const next = applySessionView(base, session, state.clockOffsetMs);
  const answered = session.current?.answeredCount ?? 0;
  return {
    ...next,
    // Events may have run ahead of this response; counts only grow on a slide.
    answeredCount: sameSlide ? Math.max(state.answeredCount, answered) : answered,
    // Keep a revealed payload that arrived first (it carries the final distribution).
    reveal: sameSlide && next.phase === "revealed" && state.reveal ? state.reveal : next.reveal,
    timing: sameSlide && next.phase === "open" && state.timing ? state.timing : next.timing,
  };
}

const deckQuestion = (state: LiveState, slideIndex: number) => state.deck?.slides[slideIndex]?.question ?? "";

function addParticipant(state: LiveState, participantId: string, name: string): LiveState {
  if (state.participants.some((p) => p.participantId === participantId)) return state;
  return { ...state, participants: [...state.participants, { participantId, name }] };
}

/** Merges new results of a slide into the host's per-slide results. */
function withResults(state: LiveState, slideId: string, patch: Partial<SlideResultsView> & { slideIndex: number }) {
  const prev = state.results[slideId];
  const merged: SlideResultsView = {
    slideId,
    type: prev?.type ?? state.deck?.slides[patch.slideIndex]?.type ?? "",
    scored: prev?.scored ?? false,
    answeredCount: prev?.answeredCount ?? 0,
    participantCount: prev?.participantCount ?? state.participants.length,
    distribution: prev?.distribution as RevealDistribution,
    ...patch,
  };
  return { ...state.results, [slideId]: merged };
}

/** Host: every core event of the followed session. */
function hostEvent(state: LiveState, event: PresentationRealtimeEvent, receivedAt: number | undefined): LiveState {
  if (isRealtimeEvent(event, "participant:joined")) {
    return addParticipant(state, event.payload.participantId, event.payload.name);
  }

  if (isRealtimeEvent(event, "answer:received")) {
    const { slideId, slideIndex, answeredCount, participantCount, distribution } = event.payload;
    const results = withResults(state, slideId, {
      slideIndex,
      answeredCount,
      ...(participantCount !== undefined ? { participantCount } : {}),
      ...(distribution ? { distribution } : {}),
    });
    if (slideId !== state.slideId) return { ...state, results };
    return {
      ...state,
      results,
      // Per-answer events and the 2 s worker interleave; counts only grow on a slide.
      answeredCount: Math.max(state.answeredCount, answeredCount),
      distribution: distribution ?? state.distribution,
    };
  }

  if (isRealtimeEvent(event, "session:lobby")) {
    return {
      ...state,
      status: "lobby",
      runNumber: event.payload.runNumber,
      joinCode: event.payload.joinCode || state.joinCode,
      currentSlideIndex: -1,
      slideId: null,
      phase: null,
      isLastSlide: false,
      timing: null,
      slideTicket: null,
      reveal: null,
      distribution: null,
      answeredCount: 0,
    };
  }

  if (isRealtimeEvent(event, "question:started")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "open" });
    const results = p.reopened ? state.results[p.slideId] : undefined;
    return {
      ...next,
      timing: { startedAt: p.startedAt, endsAt: p.endsAt, clockOffsetMs: offsetOr(state, p.serverNow, receivedAt) ?? 0 },
      clockOffsetMs: offsetOr(state, p.serverNow, receivedAt),
      reveal: null,
      // A reopened slide keeps its answers; a first visit starts empty.
      distribution: results?.distribution ?? null,
      answeredCount: results?.answeredCount ?? 0,
    };
  }

  if (isRealtimeEvent(event, "slide:shown")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "shown" });
    return {
      ...next,
      clockOffsetMs: offsetOr(state, p.serverNow, receivedAt),
      distribution: null,
      answeredCount: 0,
    };
  }

  if (isRealtimeEvent(event, "slide:closed")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "closed" });
    const results = withResults(state, p.slideId, {
      slideIndex: p.slideIndex,
      answeredCount: p.answeredCount,
      participantCount: p.participantCount,
    });
    return {
      ...next,
      clockOffsetMs: offsetOr(state, p.serverNow, receivedAt),
      results,
      distribution: results[p.slideId]?.distribution ?? null,
      answeredCount: p.answeredCount,
    };
  }

  if (isRealtimeEvent(event, "question:revealed")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "revealed" });
    return {
      ...next,
      reveal: { ...revealOf(p), question: p.question || deckQuestion(state, p.slideIndex) },
      results: withResults(state, p.slideId, {
        slideIndex: p.slideIndex,
        type: p.type,
        scored: p.scored,
        answeredCount: p.answeredCount,
        participantCount: p.participantCount,
        distribution: p.distribution,
      }),
      distribution: p.distribution,
      answeredCount: p.answeredCount,
    };
  }

  if (isRealtimeEvent(event, "leaderboard:shown")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "shown" });
    return { ...next, leaderboard: p.leaderboard ?? state.leaderboard, distribution: null, answeredCount: 0 };
  }

  if (isRealtimeEvent(event, "session:ended")) return sessionEnded(state, event.payload.leaderboard);

  // `lobby:opened` / `quiz:ended` are legacy copies of `session:lobby` / `session:ended`.
  return state;
}

/** The stage-facing reveal payload of a `question:revealed` event. */
const revealOf = (p: RevealPayload): RevealPayload => ({
  slideIndex: p.slideIndex,
  question: p.question,
  type: p.type,
  scored: p.scored,
  distribution: p.distribution,
  answeredCount: p.answeredCount,
  participantCount: p.participantCount,
  isLastSlide: p.isLastSlide,
});

const sessionEnded = (state: LiveState, leaderboard: LeaderboardEntry[] | undefined): LiveState => ({
  ...state,
  status: "ended",
  phase: null,
  timing: null,
  slideTicket: null,
  leaderboard: leaderboard ?? state.leaderboard,
});

// ---------- Participant ----------

function participantInfoLoaded(
  state: LiveState,
  action: Extract<LiveAction, { type: "participant/info-loaded" }>
): LiveState {
  const { info, receivedAt } = action;
  const sessionId = action.sessionId !== undefined ? action.sessionId : (info.sessionId ?? null);
  const followed = followSession(state, sessionId);
  const clockOffsetMs = offsetOr(state, info.serverNow, receivedAt);
  const next: LiveState = {
    ...followed,
    presentationId: info.presentationId || info.quizId || null,
    title: info.title,
    status: info.status,
    totalSlides: info.totalSlides,
    currentSlideIndex: info.currentSlideIndex,
    clockOffsetMs,
    // A different session drops the old identity unless the caller brings this session's.
    self: action.self !== undefined ? action.self : followed === state ? state.self : null,
    lost: null,
  };
  // Late join / refresh: render the live slide right away (any lifecycle).
  if (info.status === "active" && info.currentSlide && info.currentSlideId && info.currentSlidePhase) {
    const at = atSlide(next, {
      slideId: info.currentSlideId,
      slideIndex: info.currentSlideIndex,
      isLastSlide: info.currentSlideIndex === info.totalSlides - 1,
      phase: info.currentSlidePhase,
    });
    return {
      ...at,
      slide: info.currentSlide,
      timing:
        info.currentSlidePhase === "open"
          ? { startedAt: info.questionStartedAt ?? null, endsAt: info.questionEndsAt ?? null, clockOffsetMs: clockOffsetMs ?? 0 }
          : null,
    };
  }
  if (info.status !== "active") return { ...next, slideId: null, phase: null, slide: null, timing: null, slideTicket: null };
  return next;
}

function participantLiveState(state: LiveState, live: ParticipantLiveState, receivedAt: number | undefined): LiveState {
  const followed = followSession(state, live.sessionId);
  const clockOffsetMs = offsetOr(state, live.serverNow, receivedAt);
  const base: LiveState = {
    ...followed,
    presentationId: live.presentationId,
    title: live.title,
    status: live.status,
    joinCode: live.joinCode || followed.joinCode,
    totalSlides: live.totalSlides,
    settings: live.settings ?? followed.settings,
    clockOffsetMs,
    me: {
      participantId: live.me.participantId,
      sessionId: live.sessionId,
      name: live.me.name,
      totalScore: live.me.totalScore,
      correctCount: live.me.correctCount,
      rank: live.me.rank,
      lastAnswer: live.me.lastAnswer,
      quizStatus: live.status,
      presentationStatus: live.status,
    },
    leaderboard: live.finalLeaderboard ?? followed.leaderboard,
  };
  const current = live.current;
  if (!current || live.status === "lobby") {
    return {
      ...base,
      currentSlideIndex: -1,
      slideId: null,
      phase: null,
      slide: null,
      timing: null,
      slideTicket: null,
      reveal: null,
      submittedSlideIndex: null,
    };
  }
  const at = atSlide(base, {
    slideId: current.slideId,
    slideIndex: current.slideIndex,
    isLastSlide: current.isLastSlide,
    phase: current.phase,
  });
  return {
    ...at,
    status: live.status,
    phase: live.status === "ended" ? null : current.phase,
    slide: current.slide ?? leaderboardSlide(current.slideIndex, live.totalSlides),
    timing:
      live.status === "active" && current.phase === "open"
        ? { startedAt: current.startedAt, endsAt: current.endsAt, clockOffsetMs: clockOffsetMs ?? 0 }
        : null,
    slideTicket: live.status === "active" && current.phase === "open" ? (current.slideTicket ?? null) : null,
    reveal:
      current.phase === "revealed" && current.results
        ? revealFromResults(current.results, current.slide?.question ?? "", current.isLastSlide)
        : null,
    leaderboard: current.leaderboard ?? base.leaderboard,
    submittedSlideIndex: live.me.answeredCurrent ? current.slideIndex : null,
  };
}

/** Participant: every core event of the followed session. */
function participantEvent(
  state: LiveState,
  event: PresentationRealtimeEvent,
  receivedAt: number | undefined
): LiveState {
  if (isRealtimeEvent(event, "participant:joined")) {
    return addParticipant(state, event.payload.participantId, event.payload.name);
  }

  if (isRealtimeEvent(event, "session:lobby")) {
    return {
      ...state,
      status: "lobby",
      runNumber: event.payload.runNumber,
      joinCode: event.payload.joinCode || state.joinCode,
      currentSlideIndex: -1,
      slideId: null,
      phase: null,
      isLastSlide: false,
      slide: null,
      timing: null,
      slideTicket: null,
      reveal: null,
      submittedSlideIndex: null,
    };
  }

  if (isRealtimeEvent(event, "question:started")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "open" });
    const clockOffsetMs = offsetOr(state, p.serverNow, receivedAt);
    return {
      ...next,
      slide: p.slide,
      timing: { startedAt: p.startedAt, endsAt: p.endsAt, clockOffsetMs: clockOffsetMs ?? 0 },
      slideTicket: p.slideTicket ?? null,
      clockOffsetMs,
      reveal: null,
      // A reopened slide stays answered for those who answered; a new one starts fresh.
      me: p.reopened ? state.me : null,
    };
  }

  if (isRealtimeEvent(event, "slide:shown")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "shown" });
    return { ...next, slide: p.slide, clockOffsetMs: offsetOr(state, p.serverNow, receivedAt) };
  }

  if (isRealtimeEvent(event, "slide:closed")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "closed" });
    return {
      ...next,
      slide: p.slide,
      clockOffsetMs: offsetOr(state, p.serverNow, receivedAt),
      answeredCount: p.answeredCount,
    };
  }

  if (isRealtimeEvent(event, "question:revealed")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "revealed" });
    return { ...next, slide: p.slide ?? state.slide, reveal: revealOf(p), answeredCount: p.answeredCount };
  }

  if (isRealtimeEvent(event, "leaderboard:shown")) {
    const p = event.payload;
    const next = atSlide(state, { slideId: p.slideId, slideIndex: p.slideIndex, isLastSlide: p.isLastSlide, phase: "shown" });
    return {
      ...next,
      slide: p.slide ?? leaderboardSlide(p.slideIndex, state.totalSlides),
      leaderboard: p.leaderboard ?? state.leaderboard,
    };
  }

  if (isRealtimeEvent(event, "session:ended")) return sessionEnded(state, event.payload.leaderboard);

  // `lobby:opened` / `quiz:ended` are legacy copies; `answer:received` never reaches participants.
  return state;
}
