import type { Presentation, PresentationSlideType, PresentationStatus } from "./deck";

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
  participants: LiveParticipant[];
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
