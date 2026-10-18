import type { Presentation, PresentationSlideType, PresentationStatus } from "./types/deck";

// Deck (authoring) types moved to ./types/deck; re-exported so `../types`
// imports keep working.
export * from "./types/deck";

/** Slide as broadcast to participants — answer keys stripped */
export interface LiveSlide {
  slideIndex: number;
  totalSlides: number;
  type: PresentationSlideType;
  scored: boolean;
  question: string;
  options: { text: string }[];
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

export type PresentationRealtimeEventType =
  | "lobby:opened"
  | "participant:joined"
  | "question:started"
  | "answer:received"
  | "question:revealed"
  | "leaderboard:shown"
  | "quiz:ended";

export interface PresentationRealtimeEvent {
  quizId: string;
  presentationId?: string;
  type: PresentationRealtimeEventType;
  payload: Record<string, unknown>;
  emittedAt: string;
}

export interface PresentationParticipantSelf {
  participantId: string;
  name: string;
  score: number;
  token: string;
  deviceToken: string;
}

export interface ParticipantState {
  participantId: string;
  name: string;
  totalScore: number;
  correctCount: number;
  rank: number;
  lastAnswer: {
    slideIndex: number;
    isCorrect: boolean;
    score: number;
    scored: boolean;
  } | null;
  quizStatus: PresentationStatus;
  presentationStatus?: PresentationStatus;
}

export interface HostState {
  quiz?: Presentation;
  presentation?: Presentation;
  serverNow: string;
  participants: { participantId: string; name: string; score: number }[];
  answeredCount: number;
  liveDistribution?: RevealDistribution | null;
  leaderboard: LeaderboardEntry[];
}

export interface PublicPresentationInfo {
  quizId?: string;
  presentationId?: string;
  title: string;
  status: PresentationStatus;
  totalSlides: number;
  currentSlideIndex: number;
  serverNow: string;
  currentSlide?: LiveSlide;
  questionStartedAt?: string;
  questionEndsAt?: string;
}
