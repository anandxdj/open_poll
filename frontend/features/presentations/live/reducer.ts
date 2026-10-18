import type {
  HostState,
  LeaderboardEntry,
  LiveParticipant,
  LiveSlide,
  ParticipantState,
  Presentation,
  PresentationRealtimeEvent,
  PresentationStatus,
  PublicPresentationInfo,
  RevealDistribution,
  RevealPayload,
} from "../types";
import { isRealtimeEvent } from "../types/realtime";

/**
 * Pure state machine behind every live surface (host console, participant
 * shell, and later the presenter/screen views). Socket events and local
 * results go in as actions; side effects (fetches, storage, toasts) stay in
 * the components and hooks that dispatch them.
 *
 * Feature modules add their own state without touching this file through
 * `registerLiveReducer(prefix, fn)`; see `docs/wiki/features/live-surfaces.md`.
 */

export type LiveRole = "host" | "participant";

export interface LiveSelf {
  participantId: string;
  name: string;
  token: string;
}

export interface LiveTiming {
  /** Deadline of the open answer window (server clock). */
  endsAt: string;
  /** Server clock read together with `endsAt` — the countdown's offset base. */
  serverNow: string;
}

export interface LiveState {
  role: LiveRole;
  presentationId: string | null;
  connected: boolean;
  status: PresentationStatus | null;
  title: string;
  joinCode: string;
  totalSlides: number;
  currentSlideIndex: number;
  /** Host only: the full deck, answer keys included. */
  deck: Presentation | null;
  /** Participant: the slide on screen, sanitized (a leaderboard slide is synthesized). */
  slide: LiveSlide | null;
  timing: LiveTiming | null;
  reveal: RevealPayload | null;
  /** Host only: pre-reveal answer distribution (`answer:received` is host-room only). */
  distribution: RevealDistribution | null;
  answeredCount: number;
  participants: LiveParticipant[];
  leaderboard: LeaderboardEntry[];
  /** Participant identity once joined. */
  self: LiveSelf | null;
  /** Participant: own score/rank/last answer. */
  me: ParticipantState | null;
  submittedSlideIndex: number | null;
  /** Sub-reducer state, keyed by the prefix the module registered with. */
  modules: Record<string, unknown>;
}

export type LiveAction =
  | { type: "live/reset"; role: LiveRole; presentationId?: string | null; self?: LiveSelf | null }
  | { type: "live/connection"; connected: boolean }
  | { type: "live/event"; event: PresentationRealtimeEvent }
  /** A feature module's own action; only its sub-reducer gives it meaning. */
  | { type: "live/module"; prefix: string; name: string; payload?: unknown }
  /** `deck` overrides the state's deck (the lobby was opened right after loading). */
  | { type: "host/state-loaded"; state: HostState; deck?: Presentation }
  | { type: "host/lobby-opened"; deck: Presentation }
  /** `serverNow` is the client clock at the response, as the advance call has no server time. */
  | { type: "host/advanced"; deck: Presentation; serverNow: string }
  | { type: "host/ended"; deck: Presentation }
  | { type: "participant/info-loaded"; info: PublicPresentationInfo }
  | { type: "participant/joined"; self: LiveSelf }
  | { type: "participant/me-loaded"; me: ParticipantState }
  | { type: "participant/submitted"; slideIndex: number };

export function createInitialLiveState(
  role: LiveRole = "participant",
  init: Partial<LiveState> = {}
): LiveState {
  return {
    role,
    presentationId: null,
    connected: false,
    status: null,
    title: "",
    joinCode: "",
    totalSlides: 0,
    currentSlideIndex: -1,
    deck: null,
    slide: null,
    timing: null,
    reveal: null,
    distribution: null,
    answeredCount: 0,
    participants: [],
    leaderboard: [],
    self: null,
    me: null,
    submittedSlideIndex: null,
    modules: initialModuleState(),
    ...init,
  };
}

// ---------- Module sub-reducers ----------

/**
 * A feature module's slice of live state. It sees every action (core and
 * module), after the core reducer ran, and must return its slice unchanged
 * (same reference) when the action is not its business.
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

// ---------- Core reducer ----------

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  return reduceModules(coreReducer(state, action), action);
}

/** `serverNow` is the server clock the deadline is read against (only used while active). */
const deckFields = (deck: Presentation, serverNow: string | null) => ({
  deck,
  status: deck.status,
  title: deck.title,
  joinCode: deck.joinCode,
  totalSlides: deck.slides.length,
  currentSlideIndex: deck.currentSlideIndex,
  timing:
    deck.status === "active" && deck.questionEndsAt && serverNow
      ? { endsAt: deck.questionEndsAt, serverNow }
      : null,
});

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

function coreReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "live/reset":
      return createInitialLiveState(action.role, {
        presentationId: action.presentationId ?? null,
        self: action.self ?? null,
      });

    case "live/connection":
      return state.connected === action.connected ? state : { ...state, connected: action.connected };

    case "live/event":
      return state.role === "host" ? hostEvent(state, action.event) : participantEvent(state, action.event);

    case "live/module":
      return state;

    case "host/state-loaded": {
      const deck = action.deck ?? action.state.presentation ?? action.state.quiz;
      if (!deck) return state;
      return {
        ...state,
        ...deckFields(deck, action.state.serverNow),
        presentationId: state.presentationId ?? deck._id,
        participants: action.state.participants,
        answeredCount: action.state.answeredCount,
        distribution: action.state.liveDistribution ?? state.distribution,
        leaderboard: action.state.leaderboard ?? state.leaderboard,
      };
    }

    case "host/lobby-opened":
      return {
        ...state,
        ...deckFields(action.deck, state.timing?.serverNow ?? null),
        participants: [],
        answeredCount: 0,
        reveal: null,
        distribution: null,
        leaderboard: [],
      };

    case "host/advanced":
      return {
        ...state,
        ...deckFields(action.deck, action.serverNow),
        reveal: null,
        answeredCount: 0,
      };

    case "host/ended":
      return { ...state, ...deckFields(action.deck, state.timing?.serverNow ?? null) };

    case "participant/info-loaded": {
      const { info } = action;
      const next: LiveState = {
        ...state,
        presentationId: info.presentationId || info.quizId || null,
        title: info.title,
        status: info.status,
        totalSlides: info.totalSlides,
        currentSlideIndex: info.currentSlideIndex,
      };
      // Late join / refresh mid-question: render the live slide right away.
      if (info.currentSlide && info.questionEndsAt) {
        next.slide = info.currentSlide;
        next.timing = { endsAt: info.questionEndsAt, serverNow: info.serverNow };
        next.submittedSlideIndex = null;
      }
      return next;
    }

    case "participant/joined":
      return { ...state, self: action.self };

    case "participant/me-loaded":
      return { ...state, me: action.me };

    case "participant/submitted":
      return { ...state, submittedSlideIndex: action.slideIndex };

    default:
      return state;
  }
}

function addParticipant(state: LiveState, event: PresentationRealtimeEvent): LiveState {
  if (!isRealtimeEvent(event, "participant:joined")) return state;
  const { participantId, name } = event.payload;
  if (state.participants.some((p) => p.participantId === participantId)) return state;
  return { ...state, participants: [...state.participants, { participantId, name }] };
}

/**
 * Host: socket events carry deltas; the console re-reads host state after
 * reveal/start/leaderboard/end (see useHostSession), so those only reset the
 * per-slide fields here.
 */
function hostEvent(state: LiveState, event: PresentationRealtimeEvent): LiveState {
  if (isRealtimeEvent(event, "participant:joined")) return addParticipant(state, event);
  if (isRealtimeEvent(event, "answer:received")) {
    return {
      ...state,
      answeredCount: event.payload.answeredCount,
      distribution: event.payload.distribution ?? state.distribution,
    };
  }
  if (isRealtimeEvent(event, "question:revealed")) return { ...state, reveal: event.payload };
  if (isRealtimeEvent(event, "question:started")) {
    return { ...state, distribution: null, reveal: null, answeredCount: 0 };
  }
  return state;
}

function participantEvent(state: LiveState, event: PresentationRealtimeEvent): LiveState {
  if (isRealtimeEvent(event, "participant:joined")) return addParticipant(state, event);

  if (isRealtimeEvent(event, "lobby:opened")) {
    // (Re)opening the lobby wipes every participant server-side, so the
    // stored identity is dead; the shell drops it from storage too.
    return {
      ...state,
      status: "lobby",
      currentSlideIndex: -1,
      slide: null,
      timing: null,
      reveal: null,
      me: null,
      submittedSlideIndex: null,
      self: null,
    };
  }

  if (isRealtimeEvent(event, "question:started")) {
    const { slide, endsAt, serverNow } = event.payload;
    return {
      ...state,
      status: "active",
      currentSlideIndex: slide.slideIndex,
      slide,
      timing: { endsAt, serverNow },
      reveal: null,
      me: null,
      submittedSlideIndex: null,
    };
  }

  // Correct answer broadcast (timer hit 0). Status stays "active".
  if (isRealtimeEvent(event, "question:revealed")) return { ...state, reveal: event.payload };

  if (isRealtimeEvent(event, "leaderboard:shown")) {
    const { slideIndex, leaderboard } = event.payload;
    return {
      ...state,
      status: "active",
      currentSlideIndex: slideIndex,
      slide: leaderboardSlide(slideIndex, state.totalSlides),
      timing: null,
      reveal: null,
      leaderboard: leaderboard ?? state.leaderboard,
    };
  }

  if (isRealtimeEvent(event, "quiz:ended")) {
    return {
      ...state,
      status: "ended",
      leaderboard: event.payload.leaderboard ?? state.leaderboard,
    };
  }

  return state;
}
