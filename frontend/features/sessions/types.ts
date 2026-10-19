// Wire types of the sessions API (history, reports, exports, sharing, take-home),
// mirroring backend/src/modules/sessions/contract.ts. Dates are ISO strings, ids 24-hex.

export type SessionPace = "presenter" | "audience";
export type SessionStatus = "lobby" | "active" | "ended";
export type SlidePhase = "shown" | "open" | "closed" | "revealed";
export type SlideLifecycle = "response" | "system" | "content" | "board";

/** A slide type's results payload; `kind` tells the stage view how to draw it. */
export type SlideDistribution = Record<string, unknown> & { kind?: string };

export interface LeaderboardEntry {
  participantId: string;
  name: string;
  score: number;
  correctCount: number;
  rank: number;
}

export interface SessionShare {
  /** Only sent to members allowed to share. */
  token: string | null;
  enabled: boolean;
  includeNames: boolean;
  createdAt: string;
  expiresAt: string | null;
  /** False once disabled or expired: the public link answers 404. */
  active: boolean;
}

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
  shared: boolean;
}

export interface SessionListPage {
  presentation: { presentationId: string; title: string };
  items: SessionSummaryItem[];
  nextCursor: string | null;
}

export interface ReportSlide {
  slideId: string;
  slideIndex: number;
  type: string;
  typeName: string;
  kind: string | null;
  lifecycle: SlideLifecycle;
  label: string;
  scored: boolean;
  visited: boolean;
  phase: SlidePhase | null;
  answeredCount: number;
  distribution: SlideDistribution | null;
  /** The slide as it ran (deck snapshot, answer keys included, notes removed). */
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

export type ExportFormat = "csv" | "xlsx" | "pdf";

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
    responseSlideCount: number;
    participationRate: number | null;
    retainUntil: string | null;
  };
  slides: ReportSlide[];
  leaderboard: LeaderboardEntry[];
  participants: ReportParticipant[];
  share: SessionShare | null;
  access: { export: boolean; share: boolean; delete: boolean };
  exports: { plan: string } & Record<ExportFormat, boolean>;
}

export interface ShareInput {
  includeNames?: boolean;
  /** ISO date; null = never expires; omitted = keep the current expiry. */
  expiresAt?: string | null;
  /** Issue a new token, invalidating links shared before. */
  rotate?: boolean;
}

export interface PublicResultSlide {
  slideIndex: number;
  type: string;
  label: string;
  scored: boolean;
  answeredCount: number;
  distribution: SlideDistribution;
  /** The participant-facing slide (no notes, no answer keys). */
  slide: Record<string, unknown>;
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
  leaderboard: { rank: number; name: string; score: number; correctCount: number }[] | null;
}

export interface TakeHomeSlide {
  slideId: string;
  slideIndex: number;
  type: string;
  label: string;
  scored: boolean;
  answered: boolean;
  answer: string | null;
  /** Null while the slide is still open (or the slide is not scored / not answered). */
  isCorrect: boolean | null;
  points: number | null;
  timeMs: number | null;
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

/** Error code of `409` on share/delete while the session still runs. */
export const SESSION_LIVE_CODE = "SESSION_LIVE";
