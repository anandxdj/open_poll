import type { Presentation, PresentationSlideType, PresentationStatus } from "./deck";

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

/** One participant's answer, as the slide type's ParticipantView submits it. */
export interface AnswerPayload {
  /** select_answer */
  optionIndex?: number;
  /**
   * Generic answer, checked by the slide type's own answer schema; the server
   * uses it instead of the per-type fields. select_answer with
   * `allowMultiple`: `{ optionIndices }`.
   */
  payload?: { optionIndices: number[] };
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
  /** Response slides only. `questionEndsAt` is null while the slide is untimed and open. */
  questionStartedAt?: string;
  questionEndsAt?: string | null;
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
  theme: Record<string, unknown> | null;
  current: {
    slideId: string;
    slideIndex: number;
    phase: SlidePhase;
    isLastSlide: boolean;
    slide: LiveSlide;
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
}

/** `POST /:id/host/{open-lobby,start,goto,close,reopen,reveal,end}`: the deck plus the session acted on. */
export type HostCommandResponse = Presentation & { session: SessionView };
