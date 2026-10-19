import { liveReducer, type LiveAction, type LiveState } from "@/features/presentations/live/reducer";
import type {
  HostState,
  LeaderboardEntry,
  LiveSlide,
  ParticipantLiveState,
  Presentation,
  PresentationRealtimeEvent,
  PresentationSlide,
  RevealDistribution,
  SessionView,
  SlideResultsView,
} from "@/features/presentations/types";

// Shared fixtures of the live unit tests: one deck of three slides (a scored
// select answer, a heading, a leaderboard) and the session views, REST bodies
// and envelopes built around it.

export const PID = "64b000000000000000000001";
export const SID = "64b0000000000000000000a1";
export const SID2 = "64b0000000000000000000a2";
export const SLIDE_IDS = ["64b0000000000000000000c1", "64b0000000000000000000c2", "64b0000000000000000000c3"];

/** Server clock at the moment the fixtures treat as "now". */
export const T0 = Date.parse("2026-01-01T00:00:00.000Z");
export const iso = (ms: number) => new Date(ms).toISOString();
/** An ISO time `seconds` after T0. */
export const at = (seconds: number) => iso(T0 + seconds * 1000);

export const slide = (overrides: Partial<PresentationSlide> = {}): PresentationSlide => ({
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

export const deck = (overrides: Partial<Presentation> = {}): Presentation => ({
  _id: PID,
  creatorId: "u1",
  title: "Deck",
  joinCode: "123456",
  status: "draft",
  currentSlideIndex: -1,
  questionStartedAt: null,
  questionEndsAt: null,
  slides: [
    slide(),
    slide({ type: "heading", question: "", timeLimit: 0, points: 0, content: { title: "Hello", subtitle: "" } }),
    slide({ type: "leaderboard", question: "Standings", timeLimit: 0, points: 0 }),
  ],
  createdAt: at(-3600),
  updatedAt: at(-3600),
  ...overrides,
});

export const liveSlide = (overrides: Partial<LiveSlide> = {}): LiveSlide => ({
  slideIndex: 0,
  totalSlides: 3,
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

export const headingSlide = (): LiveSlide =>
  liveSlide({ slideIndex: 1, type: "heading", scored: false, question: "", timeLimit: 0, points: 0 });

export const distribution: RevealDistribution = {
  kind: "options",
  counts: [1, 0],
  options: [
    { text: "A", isCorrect: true },
    { text: "B", isCorrect: false },
  ],
};

export const results = (overrides: Partial<SlideResultsView> = {}): SlideResultsView => ({
  slideId: SLIDE_IDS[0],
  slideIndex: 0,
  type: "select_answer",
  scored: true,
  answeredCount: 1,
  participantCount: 2,
  distribution,
  ...overrides,
});

export const standings: LeaderboardEntry[] = [
  { participantId: "p1", name: "Ada", score: 900, correctCount: 1, rank: 1 },
  { participantId: "p2", name: "Grace", score: 0, correctCount: 0, rank: 2 },
];

export type CurrentOverrides = Partial<NonNullable<SessionView["current"]>>;

/** A session view whose current slide is the deck's first (open, timed 30 s) unless overridden. */
export const sessionView = (
  overrides: Partial<SessionView> = {},
  current: CurrentOverrides | null = {}
): SessionView => ({
  sessionId: SID,
  presentationId: PID,
  runNumber: 1,
  pace: "presenter",
  status: "active",
  isLive: true,
  joinCode: "123456",
  hostUserId: "u1",
  startedAt: at(-60),
  endedAt: null,
  totalSlides: 3,
  currentSlideId: SLIDE_IDS[0],
  currentSlideIndex: 0,
  current:
    current === null
      ? null
      : {
          slideId: SLIDE_IDS[0],
          slideIndex: 0,
          type: "select_answer",
          lifecycle: "response",
          scored: true,
          phase: "open",
          openedAt: at(0),
          endsAt: at(30),
          pausedRemainingMs: null,
          closedAt: null,
          revealedAt: null,
          answeredCount: 1,
          isLastSlide: false,
          ...current,
        },
  participantCount: 2,
  answerCount: 1,
  audienceCap: null,
  retainUntil: null,
  ...overrides,
});

export const lobbySession = () =>
  sessionView({ status: "lobby", currentSlideId: null, currentSlideIndex: -1 }, null);

export const hostState = (session: SessionView | null, extra: Partial<HostState> = {}): HostState => ({
  presentation: deck(),
  serverNow: at(1),
  session,
  participants: [
    { participantId: "p1", name: "Ada", score: 0 },
    { participantId: "p2", name: "Grace", score: 0 },
  ],
  answeredCount: 1,
  liveDistribution: null,
  leaderboard: [],
  slideStates: [],
  distributions: {},
  ...extra,
});

export const liveState = (
  overrides: Partial<ParticipantLiveState> = {},
  current: Partial<NonNullable<ParticipantLiveState["current"]>> | null = {}
): ParticipantLiveState => ({
  presentationId: PID,
  sessionId: SID,
  title: "Deck",
  status: "active",
  pace: "presenter",
  joinCode: "123456",
  totalSlides: 3,
  serverNow: at(10),
  settings: null,
  theme: null,
  current:
    current === null
      ? null
      : {
          slideId: SLIDE_IDS[0],
          slideIndex: 0,
          phase: "open",
          isLastSlide: false,
          slide: liveSlide(),
          startedAt: at(0),
          endsAt: at(30),
          results: null,
          leaderboard: null,
          ...current,
        },
  me: { participantId: "p1", name: "Ada", totalScore: 0, correctCount: 0, rank: 1, answeredCurrent: false, lastAnswer: null },
  finalLeaderboard: null,
  ...overrides,
});

export interface EnvelopeOptions {
  seq?: number;
  sessionId?: string | null;
  receivedAt?: number;
}

/** A `live/event` action wrapping an envelope of the followed session (SID) unless told otherwise. */
export const event = (
  type: string,
  payload: Record<string, unknown>,
  { seq, sessionId = SID, receivedAt }: EnvelopeOptions = {}
): LiveAction => ({
  type: "live/event",
  receivedAt,
  event: {
    v: 1,
    presentationId: PID,
    quizId: PID,
    sessionId,
    seq,
    type,
    audience: "all",
    payload,
    emittedAt: at(0),
  } as PresentationRealtimeEvent,
});

export const run = (state: LiveState, ...actions: LiveAction[]) => actions.reduce(liveReducer, state);

export const SELF = { participantId: "p1", name: "Ada", token: "t".repeat(32) };
