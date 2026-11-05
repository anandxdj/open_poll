import type { Presentation, PresentationSlideType, PresentationStatus } from "./deck";
import type { ThemeTokens } from "@/features/themes/types";

/**
 * Live-session wire types. Mirror of the session engine contract in
 * `backend/src/modules/presentations/live/contract.ts` (prose:
 * `backend/docs/wiki/modules/presentations-live.md`). HTTP bodies arrive
 * wrapped as `{ success, message, data }`; these describe `data`.
 */

// ---------- Sessions and slide state ----------

export type SessionPace = "presenter" | "audience";
export type SessionStatus = "lobby" | "active" | "ended";

/**
 * Where a slide is in its lifecycle: `shown` (content, board, system slides),
 * or a response slide's `open` → `closed` → `revealed` (`reopen` goes back to
 * `open`).
 */
export type SlidePhase = "shown" | "open" | "closed" | "revealed";

export type SlideLifecycle = "response" | "system" | "content" | "board";

/** One visited slide of a session. */
export interface SlideStateView {
  slideId: string;
  slideIndex: number;
  type: string;
  lifecycle: SlideLifecycle;
  scored: boolean;
  phase: SlidePhase;
  openedAt: string | null;
  /** Answer deadline; null while untimed, while the timer is paused, or for slides without an answer window. */
  endsAt: string | null;
  /** Time left while the timer is paused (W2-A); null while it runs or when untimed. */
  pausedRemainingMs: number | null;
  /** When the running pause began (absent from older APIs). */
  pausedAt?: string | null;
  /** The timer's whole budget (time limit plus extensions, ms); null when untimed (absent from older APIs). */
  durationMs?: number | null;
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
  audienceCap: number | null;
  retainUntil: string | null;
  /** The deck theme snapshotted when the session opened (W3-A); absent from older APIs. */
  theme?: ThemeTokens | null;
}

/** Results of one response slide (host view; also what a reveal broadcasts). */
export interface SlideResultsView {
  slideId: string;
  slideIndex: number;
  type: string;
  scored: boolean;
  answeredCount: number;
  participantCount: number;
  distribution: RevealDistribution;
}

/** Deck-level settings, snapshotted on the session (`ParticipantLiveState.settings`). */
export interface DeckSettings {
  audienceLocale: string;
  nickname: "required" | "optional" | "off";
  showResultsOnDevices: boolean;
  qna: { enabled: boolean; moderation: boolean; anonymousAllowed: boolean; upvotes: boolean };
  reactions: { enabled: boolean; emojis: string[] };
  quiz: { leaderboard: boolean; showCorrectOnDevices: boolean };
  audiencePaced: {
    resultsVisibility: "never" | "after_submit" | "after_close";
    assessment: { enabled: boolean; passingScorePercentage: number; maxAttempts: number | null };
  };
  embed: { allowed: boolean };
  /** Mask profanity in word-cloud and open-ended answers (W2-A); absent from older APIs. */
  profanityFilter?: boolean;
}

// ---------- Slides and results ----------

/** Slide as broadcast to participants — answer keys stripped */
export interface LiveSlide {
  slideIndex: number;
  totalSlides: number;
  type: PresentationSlideType;
  scored: boolean;
  question: string;
  options: { text: string }[];
  /** select_answer: present (true) only when participants may pick several options. */
  allowMultiple?: boolean;
  statements: string[];
  minLabel: string;
  maxLabel: string;
  scaleMax: number;
  items: string[];
  maxEntries: number;
  timeLimit: number;
  points: number;
  scoreDependsOnTime: boolean;
}

/** A participant as the host (and the lobby) sees them. */
export interface LiveParticipant {
  participantId: string;
  name: string;
  score?: number;
  correctCount?: number;
  joinedAt?: string;
  /** Removed by the host (host state only). */
  kicked?: boolean;
}

export interface LeaderboardEntry {
  participantId: string;
  name: string;
  score: number;
  correctCount: number;
  rank: number;
}

export type RevealDistribution =
  | {
      kind: "options";
      counts: number[];
      options: { text: string; isCorrect: boolean }[];
    }
  | {
      kind: "text";
      answers: { text: string; count: number; isCorrect: boolean }[];
      acceptedAnswers: string[];
    }
  | {
      kind: "words";
      words: { text: string; count: number }[];
    }
  | {
      kind: "responses";
      responses: { text: string; count: number }[];
    }
  | {
      kind: "scales";
      statements: { statement: string; average: number; count: number }[];
      scaleMax: number;
      minLabel: string;
      maxLabel: string;
    }
  | {
      kind: "ranking";
      items: { text: string; points: number; rank: number }[];
      voters: number;
    };

/** Revealed results of the slide on screen, as the stage and the participant render them. */
export interface RevealPayload {
  slideIndex: number;
  question: string;
  type: PresentationSlideType;
  scored: boolean;
  distribution: RevealDistribution;
  answeredCount: number;
  participantCount: number;
  isLastSlide: boolean;
}

/** The channel an answer arrived on (`AnswerResult.via`); the original's channel on a replay. */
export type AnswerVia = "rest" | "socket" | "offline";

/**
 * `data` of an accepted `POST /:id/answer` (and of the socket ack). A repeat
 * of an accepted answer — same `clientAnswerId` — returns the original with
 * `replay: true` and counts nothing twice. Grading is never included: results
 * stay hidden until the slide is revealed.
 */
export interface AnswerResult {
  accepted: true;
  replay: boolean;
  slideId: string;
  slideIndex: number;
  clientAnswerId: string | null;
  via: AnswerVia;
  answeredAt: string;
}

/**
 * Body of `POST /:id/answer`, and (plus `presentationId`) of the socket
 * `answer:submit`: who answers, which slide, the answer itself, and the
 * idempotency and grace fields of the answer path
 * (`backend/docs/wiki/modules/presentations-live.md`, "Answer path").
 */
export interface AnswerRequest extends AnswerPayload {
  participantId: string;
  participantToken: string;
  slideIndex: number;
  sessionId?: string;
  slideId?: string;
  /** Idempotency key (≤ 64 chars): repeating an accepted answer with it returns the original, `replay: true`. */
  clientAnswerId?: string;
  /** From `question:started` / `live-state`: lets a late answer through the grace period. */
  slideTicket?: string;
  /** Held in the offline queue before sending (stored as `via: "offline"`). */
  offline?: boolean;
}

/** One participant's answer, as the slide type's ParticipantView submits it. */
export interface AnswerPayload {
  /** select_answer */
  optionIndex?: number;
  /**
   * Generic answer, checked by the slide type's own answer schema; the server
   * uses it instead of the per-type fields. select_answer with
   * `allowMultiple`: `{ optionIndices }`; guess_number `{ value }`;
   * hundred_points `{ points }`; grid_2x2 `{ positions }`; pin_on_image `{ x, y }`.
   */
  payload?: Record<string, unknown>;
  /** type_answer, open_ended */
  text?: string;
  /** wordcloud */
  entries?: string[];
  /** scales — one rating per statement */
  ratings?: number[];
  /** ranking — item indices in the chosen order */
  ranking?: number[];
}

// ---------- Participant API ----------

/** `POST /:id/join`. */
export interface PresentationParticipantSelf {
  participantId: string;
  /** The session joined — credentials are per session. */
  sessionId: string;
  name: string;
  score: number;
  token: string;
  deviceToken: string;
}

export interface LastAnswerView {
  slideId?: string;
  slideIndex: number;
  isCorrect: boolean;
  score: number;
  scored: boolean;
}

/** `GET /:id/me`. */
export interface ParticipantState {
  participantId: string;
  sessionId?: string;
  name: string;
  totalScore: number;
  correctCount: number;
  rank: number;
  /** The participant's result on the current slide, once it is no longer open. */
  lastAnswer: LastAnswerView | null;
  quizStatus: PresentationStatus;
  presentationStatus?: PresentationStatus;
}

/** `GET /code/:code` — public deck lookup. */
export interface PublicPresentationInfo {
  quizId?: string;
  presentationId?: string;
  /** The live session; null once the deck has ended (or before the first run). */
  sessionId?: string | null;
  title: string;
  status: PresentationStatus;
  pace?: SessionPace;
  totalSlides: number;
  currentSlideIndex: number;
  serverNow: string;
  /** While `active`: the sanitized current slide (any lifecycle), its id and phase. */
  currentSlide?: LiveSlide;
  currentSlideId?: string;
  currentSlidePhase?: SlidePhase;
  /** Response slides only. `questionEndsAt` is null while the slide is untimed and open, or paused. */
  questionStartedAt?: string;
  questionEndsAt?: string | null;
  /** Response slides only: time left while the timer is paused (W2-A). */
  questionPausedRemainingMs?: number | null;
  /** Response slides only: the timer's whole budget (ms), null when untimed. */
  questionDurationMs?: number | null;
  /** The live session's theme snapshot, so the join screen already looks like the deck. */
  theme?: ThemeTokens | null;
}

/** `GET /:id/live-state` — everything a participant needs to re-render after a reconnect. */
export interface ParticipantLiveState {
  presentationId: string;
  sessionId: string;
  title: string;
  status: SessionStatus;
  pace: SessionPace;
  joinCode: string;
  totalSlides: number;
  serverNow: string;
  settings: DeckSettings | null;
  theme: ThemeTokens | null;
  current: {
    slideId: string;
    slideIndex: number;
    phase: SlidePhase;
    isLastSlide: boolean;
    slide: LiveSlide;
    startedAt: string | null;
    /** null while untimed or paused. */
    endsAt: string | null;
    /** Time left while the timer is paused (W2-A). */
    pausedRemainingMs?: number | null;
    /** The timer's whole budget (ms), null when untimed. */
    durationMs?: number | null;
    /** Open response slides only: send it back as `slideTicket` with the answer (late answers need it). */
    slideTicket: string | null;
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

// ---------- Host API ----------

/** `GET /:id/host/state`. */
export interface HostState {
  /** Legacy alias of `presentation`. */
  quiz?: Presentation;
  presentation?: Presentation;
  serverNow: string;
  /** The live session, else the most recent ended one, else null (never presented). */
  session: SessionView | null;
  /** Participants of `session`, in join order. */
  participants: LiveParticipant[];
  /** Answers to the current slide. */
  answeredCount: number;
  /** Current response slide's distribution (host only), whatever its phase. */
  liveDistribution?: RevealDistribution | null;
  leaderboard: LeaderboardEntry[];
  /** Every visited slide, in deck order. */
  slideStates: SlideStateView[];
  /** Results of every visited response slide, by slideId. */
  distributions: Record<string, SlideResultsView>;
  /** The deck's theme as it is now (light or dark, preset, kit): the stage draws it while no session is live. Absent from older APIs. */
  deckTheme?: ThemeTokens | null;
}

/** `POST /:id/host/{open-lobby,start,goto,close,reopen,reveal,end}`: the deck plus the session acted on. */
export type HostCommandResponse = Presentation & { session: SessionView };

// ---------- Presenter tools (W2-A) ----------

/** `POST /:id/host/participants/:pid/kick`. */
export interface KickResponse {
  participantId: string;
  name: string;
  kicked: true;
  participantCount: number;
}

export type TimerAction = "pause" | "resume" | "extend" | "skip";

/** `POST /:id/host/remote-token` (201): the pairing token, shown once (only its hash is stored). */
export interface RemoteTokenCreated {
  token: string;
  /** App path of the remote page: `/remote/<token>`. */
  path: string;
  expiresAt: string;
}

/** `GET|DELETE /:id/host/remote-token`. */
export interface RemoteStatus {
  paired: boolean;
  bound: boolean;
  boundAt: string | null;
  expiresAt: string | null;
  connected: boolean;
}

export type RemoteCommand = "next" | "prev" | "reveal" | "close" | "extend30" | "pause" | "resume";

/** The slide a phone remote shows (speaker notes included: the remote is the presenter's device). */
export interface RemoteSlideView {
  slideId: string;
  slideIndex: number;
  type: string;
  lifecycle: SlideLifecycle;
  title: string;
  phase: SlidePhase;
  isLastSlide: boolean;
  timed: boolean;
  startedAt: string | null;
  endsAt: string | null;
  pausedRemainingMs: number | null;
  durationMs: number | null;
  answeredCount: number;
  notes: string;
}

/** `GET /api/remote/:token/state`, the `remote:join` ack and every `remote:command` ack. */
export interface RemoteState {
  presentationId: string;
  title: string;
  status: SessionStatus | "draft";
  sessionId: string | null;
  joinCode: string;
  participantCount: number;
  totalSlides: number;
  currentSlideIndex: number;
  slide: RemoteSlideView | null;
  next: { slideIndex: number; type: string; title: string } | null;
  /** The live session's theme snapshot, else the deck's current theme (absent from older APIs). */
  theme?: ThemeTokens | null;
  serverNow: string;
}

export type RemoteJoinAck =
  | { ok: true; state: RemoteState }
  | { ok: false; error: "INVALID_PAYLOAD" | "RATE_LIMITED" | "REMOTE_INVALID" | "REMOTE_BOUND" | "UNAVAILABLE" };

export type RemoteCommandAck =
  | { ok: true; command: RemoteCommand; state: RemoteState }
  | {
      ok: false;
      error: "INVALID_PAYLOAD" | "NOT_JOINED" | "RATE_LIMITED" | "REMOTE_INVALID" | "FORBIDDEN" | "COMMAND_FAILED" | "UNAVAILABLE";
      code?: string;
      message?: string;
    };
