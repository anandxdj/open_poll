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
    /** Minutes after `open-audience` the slides close on their own (W2-F); null = until the host closes them. */
    closeAfterMinutes: number | null;
    /** `maxAttempts: null` = unlimited retries. */
    assessment: { enabled: boolean; passingScorePercentage: number; maxAttempts: number | null };
  };
  embed: { allowed: boolean };
  /** Mask profanity in word-cloud and open-ended answers (W2-A); off by default. Q&A is always masked. */
  profanityFilter: boolean;
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
  /** Answer deadline; null while untimed, while the timer is paused, or for slides without an answer window. */
  endsAt: string | null;
  /** Time left while the timer is paused (W2-A); null while it runs or when untimed. */
  pausedRemainingMs: number | null;
  /** When the running pause began; null unless paused. */
  pausedAt: string | null;
  /** The timer's whole budget (time limit plus extensions, ms); null when untimed. */
  durationMs: number | null;
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
  /** The deck theme snapshotted when the session opened (W3-A); null for sessions from before. */
  theme: ThemeTokens | null;
  /** Audience pace (W2-F): when the slides opened, when they close on their own, when they closed. Null for presenter pace. */
  audience: AudienceWindowView | null;
}

// ---------------------------------------------------------------------------
// Audience pace (W2-F)
// ---------------------------------------------------------------------------

/** Why an audience-paced session stopped taking answers. */
export type AudienceCloseReason = 'host' | 'schedule' | 'ended';

/** The answer window of an audience-paced session: every response slide is open between `openedAt` and the close. */
export interface AudienceWindowView {
  /** null while the session waits in its lobby. */
  openedAt: string | null;
  /** When the slides close on their own (the `audience-autoclose` job); null = until the host closes them. */
  closesAt: string | null;
  closedAt: string | null;
  closeReason: AudienceCloseReason | null;
}

export interface AudienceAssessmentSettings {
  enabled: boolean;
  passingScorePercentage: number;
  /** null = unlimited (capped at `AUDIENCE_UNLIMITED_ATTEMPTS`). */
  maxAttempts: number | null;
}

/** One submitted attempt of a participant (audience pace). */
export interface AudienceAttemptResult {
  number: number;
  submittedAt: string;
  /** Points of graded slides; no speed points in audience pace. */
  score: number;
  /** Points available on graded slides. */
  maxScore: number;
  /** round(score / maxScore × 100); null when the deck has no graded slide. */
  percentage: number | null;
  correctCount: number;
  answeredCount: number;
  /** Response slides in the deck. */
  totalQuestions: number;
  /** Against `passingScorePercentage` when the assessment is on; else null. */
  passed: boolean | null;
}

/** `POST /:id/host/open-audience` body. */
export interface OpenAudienceBody {
  /**
   * ISO time in the future (at most 30 days ahead); null = until the host
   * closes. Omitted: the deck's `closeAfterMinutes` from now, else no closing time.
   */
  closesAt?: string | null;
}

/** One slide of an audience-paced deck as the participant sees it. */
export interface AudienceSlideView {
  slideId: string;
  slideIndex: number;
  lifecycle: SlideLifecycle;
  slide: ParticipantSlide;
  /** `shown` for slides without answers; response slides `open` or `closed`. */
  phase: SlidePhase;
  /** Open response slides: send it back as `slideTicket` (grace after `closesAt`). */
  slideTicket: string | null;
  /** Answered in the participant's current attempt. */
  answered: boolean;
  /** The participant's answer in the current attempt (what they sent), when answered. */
  response: { optionIndex: number | null; text: string | null; payload: unknown } | null;
  /** Graded slides, once the answer key may be shown (`AudienceParticipantView.final`): right or wrong. */
  isCorrect: boolean | null;
  score: number | null;
  /** select_answer explanation, under the same rule as `isCorrect`. */
  explanation: string | null;
  /** The slide's results, when `resultsVisibility` allows (and, for graded slides of an assessment, once final). */
  results: SlideResultsView | null;
}

/** The participant's own run through an audience-paced deck (`live-state.audience`). */
export interface AudienceParticipantView {
  /** `waiting`: lobby, the host has not opened the slides; `open`; `closed`: no more answers (closed, or the session ended). */
  status: 'waiting' | 'open' | 'closed';
  window: AudienceWindowView;
  resultsVisibility: ResultsVisibility;
  assessment: AudienceAssessmentSettings;
  /** The current attempt (1, 2, …) and whether it was submitted. */
  attempt: { number: number; submitted: boolean; submittedAt: string | null };
  /** Submitted attempts, oldest first. */
  attempts: AudienceAttemptResult[];
  /** Attempts still allowed after the current one; null = unlimited. */
  attemptsLeft: number | null;
  canRetry: boolean;
  /** Nothing can change any more (passed, out of attempts, closed, or a submitted run without an assessment): answer keys may show. */
  final: boolean;
  slides: AudienceSlideView[];
}

/** One participant on the host's audience dashboard. */
export interface AudienceParticipantProgress {
  participantId: string;
  name: string;
  joinedAt: string;
  kicked: boolean;
  attempt: number;
  /** Response slides answered in the current attempt. */
  answeredCount: number;
  submitted: boolean;
  /** The latest submitted attempt. */
  lastResult: AudienceAttemptResult | null;
}

/** `host/state.audience`: progress of an audience-paced session. */
export interface HostAudienceView {
  window: AudienceWindowView;
  resultsVisibility: ResultsVisibility;
  assessment: AudienceAssessmentSettings;
  totalQuestions: number;
  participantCount: number;
  /** Participants who answered at least one slide in their current attempt. */
  startedCount: number;
  /** Participants whose current attempt is submitted. */
  completedCount: number;
  passedCount: number;
  failedCount: number;
  /** Response slides in deck order; `answeredCount` = participants whose current attempt answered it. */
  slides: { slideId: string; slideIndex: number; type: string; label: string; scored: boolean; answeredCount: number }[];
  participants: AudienceParticipantProgress[];
}

/** `POST /:id/audience/{submit,retry}` body. */
export interface AudienceAttemptBody {
  participantId: string;
  participantToken: string;
  /** submit: the attempt being submitted. */
  attempt?: number;
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
  /** Audience-paced sessions (W2-F): who is in, progress per slide, completions. Null for presenter pace. */
  audience: HostAudienceView | null;
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
  /** Response slides only. `questionEndsAt` is null while the slide is untimed and open, or paused. */
  questionStartedAt?: string;
  questionEndsAt?: string | null;
  /** Response slides only: time left while the timer is paused (W2-A), else null. */
  questionPausedRemainingMs?: number | null;
  /** Response slides only: the timer's whole budget (ms), null when untimed. */
  questionDurationMs?: number | null;
  /** The session's nickname rule (deck setting `nickname`): `optional` and `off` join as "Guest NNNN". */
  nickname: NicknameMode;
  /** Audience pace (W2-F): the live session's answer window; null otherwise. */
  audience: AudienceWindowView | null;
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
    /** null while untimed or paused. */
    endsAt: string | null;
    /** Time left while the timer is paused (W2-A), else null. */
    pausedRemainingMs: number | null;
    /** The timer's whole budget (time limit plus extensions, ms); null when untimed. */
    durationMs: number | null;
    /** Open response slides only: send it back as `slideTicket` with the answer. */
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
  /** Audience pace (W2-F): the participant's own run through the deck; null for presenter pace. */
  audience: AudienceParticipantView | null;
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
    /**
     * HMAC proof that the client saw this window open (`slideTicket` in answers):
     * the same value for every viewer of this run of the slide, never a secret
     * about who answers. A reopened slide gets a new one.
     */
    slideTicket: string;
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
  /**
   * Host only (forced), coalesced: at most one per dirty slide per 250 ms window per session
   * (`live/coalescer.ts`), carrying the slide's current counts and distribution.
   */
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
  /**
   * The current response slide's timer changed (W2-A): paused, resumed, extended,
   * or skipped (time's up now). `endsAt` is null while paused; then
   * `pausedRemainingMs` is the frozen time left.
   */
  'slide:timing': SlideTimingPayload;
  /**
   * The host removed a participant (W2-A). Sent to the host room and to the removed
   * participant's own room; the participant's sockets then leave the deck's rooms.
   */
  'participant:kicked': { participantId: string; name: string; participantCount: number };
  /** Audience pace (W2-F): every response slide is open; participants go at their own pace. Also sent when `closesAt` changes. */
  'audience:opened': { openedAt: string; closesAt: string | null; serverNow: string };
  /** Audience pace: no more answers (the host closed, the closing time passed, or the session ended). */
  'audience:closed': { closedAt: string; reason: AudienceCloseReason };
  /** Host only: a participant submitted an attempt or started a new one. */
  'audience:progress': {
    participantId: string;
    name: string;
    attempt: number;
    submitted: boolean;
    percentage: number | null;
    passed: boolean | null;
  };
}

export type TimerAction = 'pause' | 'resume' | 'extend' | 'skip';

export interface SlideTimingPayload {
  slideId: string;
  slideIndex: number;
  action: TimerAction;
  /** The window's opening time (unchanged by timer actions: it identifies the run of the slide). */
  startedAt: string;
  /** New deadline; null while paused. */
  endsAt: string | null;
  pausedRemainingMs: number | null;
  /** The timer's whole budget now (time limit plus extensions, ms). */
  durationMs: number | null;
  /** Seconds added by an `extend`, else 0. */
  addedSeconds: number;
  serverNow: string;
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
  /** 409 on open-lobby / start: the deck is a workspace template (W3-B2); make a deck from it first. */
  templateNotPresentable: 'TEMPLATE_NOT_PRESENTABLE',
  /** 403 on participant calls: the host removed this participant. */
  participantKicked: 'PARTICIPANT_KICKED',
  /** 409 on answers: the participant belongs to another (ended) session; rejoin. */
  participantStale: 'PARTICIPANT_STALE',
  /** 400 on answers: the slide is closed, revealed, left or its session ended. */
  notAccepting: 'NOT_ACCEPTING',
  /** 400 on answers: the timer ran out (plus grace) before the answer arrived. */
  timeUp: 'TIME_UP',
  /** 409 on answers: this participant already answered the slide (and this is not a replay). */
  alreadyAnswered: 'ALREADY_ANSWERED',
  /** 429 on answers: more than the per-participant budget of attempts. */
  answerRateLimited: 'RATE_LIMITED',
  /** 409 on answers: the host paused the timer; retry with the same `clientAnswerId` once it resumes. */
  slidePaused: 'SLIDE_PAUSED',
  /** 400 on timer commands: the current slide has no running (or paused) timer, or its window is closed. */
  noTimer: 'NO_TIMER',
  /** 400 on resume / 409 on pause: the timer is not paused / already paused. */
  timerState: 'TIMER_STATE',
  /** 404 on kick: no such participant in the live session. */
  participantNotFound: 'PARTICIPANT_NOT_FOUND',
  /** 409 on audience commands for a presenter-paced deck or session (W2-F). */
  notAudiencePaced: 'NOT_AUDIENCE_PACED',
  /** 409 on slide commands (goto, start's slide moves) for an audience-paced session: participants move themselves. */
  audiencePaced: 'AUDIENCE_PACED',
  /** 409 on answers / submit: this attempt was already submitted. */
  attemptSubmitted: 'ATTEMPT_SUBMITTED',
  /** 409 on answers / submit: the attempt named is not the participant's current one. */
  attemptStale: 'ATTEMPT_STALE',
  /** 409 on retry: no attempt left, already passed, not submitted yet, or the slides closed. */
  retryNotAllowed: 'RETRY_NOT_ALLOWED',
  /** 400 on audience participant calls before the host opened the slides. */
  audienceNotOpen: 'AUDIENCE_NOT_OPEN',
} as const;

/** Ceiling of "unlimited" attempts (`assessment.maxAttempts: null`). */
export const AUDIENCE_UNLIMITED_ATTEMPTS = 100;

// ---------------------------------------------------------------------------
// Presenter tools (W2-A): timer, kick
// ---------------------------------------------------------------------------

/** `POST /:id/host/timer`. `seconds` (5–600, default 30) applies to `extend`. */
export interface TimerCommandBody {
  action: 'pause' | 'resume' | 'extend';
  seconds?: number;
}

/** `POST /:id/host/participants/:pid/kick`. Idempotent: kicking twice answers the same. */
export interface KickResponse {
  participantId: string;
  name: string;
  kicked: true;
  /** Participants left in the session. */
  participantCount: number;
}

// ---------------------------------------------------------------------------
// Answers (REST `POST /:id/answer` and socket `answer:submit`)
// ---------------------------------------------------------------------------

export type AnswerVia = 'rest' | 'socket' | 'offline';

/**
 * `data` of an accepted answer, on REST and in the socket ack. A repeat of an
 * accepted answer (same `clientAnswerId`) returns the original with
 * `replay: true` and counts nothing twice. Grading is never included: results
 * stay hidden until the slide is revealed.
 */
export interface AnswerResult {
  accepted: true;
  replay: boolean;
  slideId: string;
  slideIndex: number;
  clientAnswerId: string | null;
  /** The channel the original answer arrived on. */
  via: AnswerVia;
  answeredAt: string;
}

/**
 * Socket `answer:submit` payload: the REST body plus the deck. The socket must have joined the deck
 * as this participant (`live:join` ack `{ok: true}` first), else the ack is 403 `NOT_JOINED`.
 */
export type AnswerSubmitPayload = { presentationId: string } & Record<string, unknown>;

/**
 * Socket ack of `answer:submit`: the REST envelope (`{success, message, code?, data}`)
 * plus the HTTP `status` the same call would have returned, so a client can treat
 * both channels alike (2xx done; 409/400 final; 429/5xx retry).
 */
export type AnswerSubmitAck =
  | { success: true; status: 200; message: string; data: AnswerResult }
  | { success: false; status: number; message: string; code?: string; data: null };

/** Socket `live:resync` payload; credentials as in `live:join`. */
export interface LiveResyncPayload {
  presentationId: string;
  role: 'host' | 'participant';
  accessToken?: string;
  participantId?: string;
  participantToken?: string;
}

/**
 * Ack of `live:resync`: the same document the HTTP read returns (`live-state` for
 * a participant, `host/state` for the host) and the deck's current envelope `seq`,
 * so the client can restart gap detection from it.
 */
export type LiveResyncAck =
  | { ok: true; role: 'participant'; seq: number; state: ParticipantLiveState }
  | { ok: true; role: 'host'; seq: number; state: HostStateResponse }
  | { ok: false; error: 'INVALID_PAYLOAD' | 'RATE_LIMITED' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'UNAVAILABLE' };
