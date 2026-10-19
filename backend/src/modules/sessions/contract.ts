import type { SlideKind, SlideLifecycle } from '../presentations/slides/types';
import type {
  LeaderboardEntry,
  ParticipantSlide,
  SessionPace,
  SessionStatus,
  SlideDistribution,
  SlidePhase,
} from '../presentations/live/contract';

/**
 * Wire contract of the sessions module (history, reports, exports, sharing,
 * participant take-home). Prose: `backend/docs/wiki/modules/sessions.md`.
 * Mirrored in the frontend's `features/sessions/types.ts`.
 *
 * Dates are ISO-8601 strings, ids 24-hex strings. JSON bodies are wrapped as
 * `{ success, message, data }`; the types describe `data`.
 */

export type { LeaderboardEntry, ParticipantSlide, SessionPace, SessionStatus, SlideDistribution, SlidePhase };

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/** A session's public results link (`/r/<token>` on the frontend). */
export interface SessionShareView {
  /** Capability token (≥128 bits); only sent to members allowed to share. */
  token: string | null;
  enabled: boolean;
  includeNames: boolean;
  createdAt: string;
  /** null = never expires. */
  expiresAt: string | null;
  /** False once disabled or expired: the public link answers 404. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// List — GET /api/sessions?presentationId&cursor&limit
// ---------------------------------------------------------------------------

export interface SessionSummaryItem {
  sessionId: string;
  presentationId: string;
  runNumber: number;
  pace: SessionPace;
  status: SessionStatus;
  isLive: boolean;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
  answerCount: number;
  retainUntil: string | null;
  /** The public results link is on (enabled and not expired). */
  shared: boolean;
}

export interface SessionListResponse {
  presentation: { presentationId: string; title: string };
  items: SessionSummaryItem[];
  /** Pass back as `cursor` for the next (older) page; null on the last page. */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Report — GET /api/sessions/:sid
// ---------------------------------------------------------------------------

export interface ReportSlide {
  slideId: string;
  slideIndex: number;
  type: string;
  /** The registry's human type name ("Select answer"); the type key for unknown types. */
  typeName: string;
  kind: SlideKind | null;
  lifecycle: SlideLifecycle;
  /** Registry `label(slide)`: the question, or the type name. */
  label: string;
  scored: boolean;
  /** Shown at least once during the session. */
  visited: boolean;
  /** Phase at report time; null when never shown. */
  phase: SlidePhase | null;
  answeredCount: number;
  /** The type's results payload (registry `distribution`); null for slides without results. */
  distribution: SlideDistribution | null;
  /** The slide as it ran (deck snapshot, answer keys included, notes removed) for the type's StageView. */
  slide: Record<string, unknown>;
}

export interface ReportParticipant {
  participantId: string;
  name: string;
  rank: number;
  score: number;
  correctCount: number;
  answeredCount: number;
  joinedAt: string;
  kicked: boolean;
}

export interface SessionReport {
  session: {
    sessionId: string;
    presentationId: string;
    title: string;
    runNumber: number;
    pace: SessionPace;
    status: SessionStatus;
    isLive: boolean;
    startedAt: string;
    endedAt: string | null;
    durationMs: number | null;
    participantCount: number;
    answerCount: number;
    /** Response slides shown during the session. */
    responseSlideCount: number;
    /** answers / (participants × shown response slides), 0–1; null without either. */
    participationRate: number | null;
    retainUntil: string | null;
  };
  slides: ReportSlide[];
  /** Final standings (live: current standings), at most 100. */
  leaderboard: LeaderboardEntry[];
  /** Every participant, ranked (score desc, then join order). */
  participants: ReportParticipant[];
  share: SessionShareView | null;
  /** What the caller may do with this session. */
  access: { export: boolean; share: boolean; delete: boolean };
  /** Export formats of the caller's workspace plan. */
  exports: { plan: string; csv: boolean; xlsx: boolean; pdf: boolean };
}

// ---------------------------------------------------------------------------
// Public results — GET /api/public/results/:token (no auth)
// ---------------------------------------------------------------------------

export interface PublicResultSlide {
  slideIndex: number;
  type: string;
  label: string;
  scored: boolean;
  answeredCount: number;
  distribution: SlideDistribution;
  /** The participant-facing slide (registry allow-list): never notes or answer keys. */
  slide: ParticipantSlide;
}

export interface PublicResults {
  title: string;
  runNumber: number;
  startedAt: string;
  endedAt: string | null;
  participantCount: number;
  answerCount: number;
  includeNames: boolean;
  slides: PublicResultSlide[];
  /** Top standings with names, only when the owner chose `includeNames`; otherwise null. */
  leaderboard: { rank: number; name: string; score: number; correctCount: number }[] | null;
}

// ---------------------------------------------------------------------------
// Participant take-home — GET /api/sessions/:sid/me?participantId&token
// ---------------------------------------------------------------------------

export interface TakeHomeSlide {
  slideId: string;
  slideIndex: number;
  type: string;
  label: string;
  scored: boolean;
  answered: boolean;
  /** The answer as text (the type's export cells). */
  answer: string | null;
  /** Hidden (null) while the slide is still open. */
  isCorrect: boolean | null;
  points: number | null;
  timeMs: number | null;
  /** The correct answer once the session ended or the slide was revealed; null when the type has none. */
  correctAnswer: string | null;
}

export interface TakeHome {
  session: {
    sessionId: string;
    title: string;
    runNumber: number;
    status: SessionStatus;
    startedAt: string;
    endedAt: string | null;
    participantCount: number;
  };
  me: {
    participantId: string;
    name: string;
    score: number;
    correctCount: number;
    rank: number;
    answeredCount: number;
  };
  slides: TakeHomeSlide[];
}

/** Error codes specific to this module (`{ success: false, message, code }`). */
export const SESSION_ERROR_CODES = {
  /** 409: sharing and deleting need an ended session. */
  sessionLive: 'SESSION_LIVE',
} as const;
