import type { SlideKind, SlideLifecycle } from '../slides/types';
import type { ThemeTokens } from '../../themes/resolve';

/**
 * Wire contract of the live session engine: HTTP response shapes and live event
 * payloads. Prose, rules and examples: `backend/docs/wiki/modules/presentations-live.md`.
 *
 * Every date is an ISO-8601 string on the wire; ids are 24-hex strings. HTTP
 * bodies arrive wrapped as `{ success, message, data }` (`ApiResponse`); the
 * types below describe `data`.
 */

// ---------------------------------------------------------------------------
// Deck-level settings and theme (stored on the Presentation, snapshotted on the session)
// ---------------------------------------------------------------------------

export type SessionPace = 'presenter' | 'audience';
export type NicknameMode = 'required' | 'optional' | 'off';
export type ResultsVisibility = 'never' | 'after_submit' | 'after_close';

export interface DeckSettings {
  /** Participant UI language (`en`, `es`). */
  audienceLocale: string;
  nickname: NicknameMode;
  showResultsOnDevices: boolean;
  qna: { enabled: boolean; moderation: boolean; anonymousAllowed: boolean; upvotes: boolean };
  reactions: { enabled: boolean; /** At most 6. */ emojis: string[] };
  quiz: { leaderboard: boolean; showCorrectOnDevices: boolean };
  audiencePaced: {
    resultsVisibility: ResultsVisibility;
    assessment: { enabled: boolean; passingScorePercentage: number; maxAttempts: number };
  };
  embed: { allowed: boolean };
}

export interface DeckThemeRef {
  presetId: string;
  brandKitId: string | null;
  overrides: Record<string, unknown> | null;
}

export type { ThemeTokens };

// ---------------------------------------------------------------------------
// Sessions and slide state
// ---------------------------------------------------------------------------

export type SessionStatus = 'lobby' | 'active' | 'ended';

/**
 * Where a slide is in its lifecycle:
 * - `shown`    — content, board and system slides: on screen, never accepts answers;
 * - `open`     — a response slide accepting answers (until `endsAt` + grace when timed);
 * - `closed`   — a response slide that stopped accepting answers, results not revealed;
 * - `revealed` — a closed response slide whose results were revealed.
 */
export type SlidePhase = 'shown' | 'open' | 'closed' | 'revealed';

export interface LeaderboardEntry {
  participantId: string;
  name: string;
  score: number;
  correctCount: number;
  rank: number;
}

/**
 * Participant-facing slide (registry `toParticipantSlide`): the type's
 * allow-listed fields plus this envelope. Never carries notes or answer keys.
 */
export type ParticipantSlide = Record<string, unknown> & {
  slideIndex: number;
  totalSlides: number;
  type: string;
  kind: SlideKind;
  scored: boolean;
  media: { url: string; alt: string; layout: string | null } | null;
  layout: string | null;
};

/** A slide type's results payload; `kind` tells the renderer (`options`, `text`, `words`, …). */
export type SlideDistribution = Record<string, unknown>;

/** One visited slide of a session. */
export interface SlideStateView {
  slideId: string;
  slideIndex: number;
  type: string;
  lifecycle: SlideLifecycle;
  scored: boolean;
  phase: SlidePhase;
  /** When the slide was first shown, or (response slides) last opened. */
  openedAt: string | null;
  /** Answer deadline; null while untimed or for slides without an answer window. */
  endsAt: string | null;
  pausedRemainingMs: number | null;
  closedAt: string | null;
  revealedAt: string | null;
  answeredCount: number;
}

export interface CurrentSlideView extends SlideStateView {
  isLastSlide: boolean;
}

export interface SessionView {
  sessionId: string;
  presentationId: string;
  /** 1 for the deck's first session, then 2, 3, … */
  runNumber: number;
  pace: SessionPace;
  status: SessionStatus;
  /** True while `lobby` or `active`; at most one live session per deck. */
  isLive: boolean;
  joinCode: string;
  hostUserId: string | null;
  startedAt: string;
  endedAt: string | null;
  totalSlides: number;
  currentSlideId: string | null;
  /** -1 in the lobby. */
  currentSlideIndex: number;
  current: CurrentSlideView | null;
  participantCount: number;
  answerCount: number;
  /** Participants allowed to join (plan entitlement snapshotted at open); null = unlimited. */
  audienceCap: number | null;
  /** When session data becomes eligible for deletion (workspace retention); null = kept. */
  retainUntil: string | null;
}

/** Results of one response slide (host view; also what `question:revealed` broadcasts). */
export interface SlideResultsView {
  slideId: string;
  slideIndex: number;
  type: string;
  scored: boolean;
  answeredCount: number;
  participantCount: number;
  distribution: SlideDistribution;
}

// ---------------------------------------------------------------------------
// HTTP responses (creator / host)
// ---------------------------------------------------------------------------

/**
 * `POST /:id/host/{open-lobby,start,goto,advance,close,reopen,reveal,end}`:
 * the deck document (as before) plus the session the command acted on.
 */
export type HostCommandResponse<TPresentation = Record<string, unknown>> = TPresentation & {
  session: SessionView;
};

export interface HostParticipantView {
  participantId: string;
  name: string;
  score: number;
  correctCount: number;
  joinedAt: string;
  kicked: boolean;
}

/** `GET /:id/host/state`. */
export interface HostStateResponse<TPresentation = Record<string, unknown>> {
  /** Legacy alias of `presentation`. */
  quiz: TPresentation;
  presentation: TPresentation;
  serverNow: string;
  /** The live session, else the most recent ended one, else null (never presented). */
  session: SessionView | null;
  /** Participants of `session`, in join order. */
  participants: HostParticipantView[];
  /** Answers to the current slide. */
  answeredCount: number;
  /** Current response slide's distribution (host only), whatever its phase. */
  liveDistribution: SlideDistribution | null;
  leaderboard: LeaderboardEntry[];
  /** Every visited slide, in deck order. */
  slideStates: SlideStateView[];
  /** Results of every visited response slide, by slideId. */
  distributions: Record<string, SlideResultsView>;
}

/** `GET /:id/sessions` (newest first). Full reports live under `/api/sessions` (W2-C). */
export interface SessionListItem {
  sessionId: string;
  runNumber: number;
  pace: SessionPace;
  status: SessionStatus;
  isLive: boolean;
  hostUserId: string | null;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
  answerCount: number;
  retainUntil: string | null;
}

// ---------------------------------------------------------------------------
// HTTP responses (participants, public)
// ---------------------------------------------------------------------------

/** `GET /code/:code`. */
export interface CodeLookupResponse {
  /** Legacy alias of `presentationId`. */
  quizId: string;
  presentationId: string;
  /** The live session; null once the deck has ended. */
  sessionId: string | null;
  title: string;
  status: 'lobby' | 'active' | 'ended';
  pace: SessionPace;
  totalSlides: number;
  currentSlideIndex: number;
  serverNow: string;
  /** While `active`: the sanitized current slide, its id and phase. */
  currentSlide?: ParticipantSlide;
  currentSlideId?: string;
  currentSlidePhase?: SlidePhase;
  /** Response slides only. `questionEndsAt` is null while the slide is untimed and open. */
  questionStartedAt?: string;
  questionEndsAt?: string | null;
}

/** `POST /:id/join`. */
export interface JoinResponse {
  participantId: string;
  sessionId: string;
  name: string;
  score: number;
  /** Secret for answers, `/me`, `/live-state` and socket joins. Never broadcast. */
  token: string;
  /** Signed device id; send it back on rejoin for the same identity in the same session. */
  deviceToken: string;
}

export interface LastAnswerView {
  slideId: string;
  slideIndex: number;
  isCorrect: boolean;
  score: number;
  scored: boolean;
}

/** `GET /:id/me` (unchanged fields plus `sessionId`). */
export interface ParticipantMeResponse {
  participantId: string;
  sessionId: string;
  name: string;
  totalScore: number;
  correctCount: number;
  rank: number;
  /** The participant's result on the current slide, once it is no longer open. */
  lastAnswer: LastAnswerView | null;
  quizStatus: SessionStatus;
  presentationStatus: SessionStatus;
}

/** `GET /:id/live-state` — everything a participant client needs to re-render after a reconnect. */
export interface ParticipantLiveState {
  presentationId: string;
  sessionId: string;
  title: string;
  status: SessionStatus;
  pace: SessionPace;
  joinCode: string;
  totalSlides: number;
  serverNow: string;
  settings: DeckSettings;
  theme: ThemeTokens | null;
  current: {
    slideId: string;
    slideIndex: number;
    phase: SlidePhase;
    isLastSlide: boolean;
    slide: ParticipantSlide;
    startedAt: string | null;
    endsAt: string | null;
    /** Revealed response slides only. */
    results: SlideResultsView | null;
    /** System (leaderboard) slides only. */
    leaderboard: LeaderboardEntry[] | null;
  } | null;
  me: {
    participantId: string;
    name: string;
    totalScore: number;
    correctCount: number;
    rank: number;
    /** Whether this participant already answered the current slide. */
    answeredCurrent: boolean;
    lastAnswer: LastAnswerView | null;
  };
  /** Final standings once the session has ended. */
  finalLeaderboard: LeaderboardEntry[] | null;
}

// ---------------------------------------------------------------------------
// Live events (payload of the v1 envelope; `sessionId` is on the envelope)
// ---------------------------------------------------------------------------

export interface PresentationEventPayloads {
  /** A new session opened its lobby. */
  'session:lobby': { runNumber: number; joinCode: string; pace: SessionPace };
  /** Legacy copy of `session:lobby`. */
  'lobby:opened': { joinCode: string };
  'participant:joined': { participantId: string; name: string; participantCount: number };
  /** A response slide opened (first visit or `reopen`). */
  'question:started': {
    slideId: string;
    slideIndex: number;
    slide: ParticipantSlide;
    startedAt: string;
    /** null = untimed: open until the host closes or reveals. */
    endsAt: string | null;
    serverNow: string;
    isLastSlide: boolean;
    reopened: boolean;
  };
  /** A content or board slide is on screen; no answer window. */
  'slide:shown': {
    slideId: string;
    slideIndex: number;
    slide: ParticipantSlide;
    isLastSlide: boolean;
    serverNow: string;
  };
  /** The current response slide stopped accepting answers (explicit close, or revisited while closed). */
  'slide:closed': {
    slideId: string;
    slideIndex: number;
    slide: ParticipantSlide;
    closedAt: string;
    answeredCount: number;
    participantCount: number;
    isLastSlide: boolean;
    revisit: boolean;
    serverNow: string;
  };
  /** Host only (forced): per answer `{slideId, slideIndex, answeredCount}`; the worker adds the distribution. */
  'answer:received': {
    slideId: string;
    slideIndex: number;
    answeredCount: number;
    participantCount?: number;
    distribution?: SlideDistribution;
  };
  /** Results of the current response slide (reveal, or revisited after a reveal). */
  'question:revealed': {
    slideId: string;
    slideIndex: number;
    slide: ParticipantSlide;
    question: string;
    type: string;
    scored: boolean;
    distribution: SlideDistribution;
    answeredCount: number;
    participantCount: number;
    isLastSlide: boolean;
    auto: boolean;
    revealedAt: string;
    revisit: boolean;
  };
  'leaderboard:shown': {
    slideId: string;
    slideIndex: number;
    slide: ParticipantSlide;
    leaderboard: LeaderboardEntry[];
    participantCount: number;
    isLastSlide: boolean;
  };
  'session:ended': {
    runNumber: number;
    endedAt: string;
    leaderboard: LeaderboardEntry[];
    participantCount: number;
    answerCount: number;
  };
  /** Legacy copy of `session:ended`. */
  'quiz:ended': { leaderboard: LeaderboardEntry[]; participantCount: number };
}

export type PresentationLiveEventType = keyof PresentationEventPayloads;

// ---------------------------------------------------------------------------
// Error codes (`{ success: false, message, code }`)
// ---------------------------------------------------------------------------

export const LIVE_ERROR_CODES = {
  /** 403 on join: the session reached its audience cap. */
  sessionFull: 'SESSION_FULL',
  /** 409 on start: a session is already presenting (end it, or open a new lobby). */
  sessionAlreadyLive: 'SESSION_ALREADY_LIVE',
  /** 409: another host command changed the session concurrently; retry. */
  sessionBusy: 'SESSION_BUSY',
  /** 400 on host commands that need a live session. */
  noLiveSession: 'NO_LIVE_SESSION',
  /** 403 on participant calls: the host removed this participant. */
  participantKicked: 'PARTICIPANT_KICKED',
  /** 409 on answers: the participant belongs to another (ended) session; rejoin. */
  participantStale: 'PARTICIPANT_STALE',
} as const;
