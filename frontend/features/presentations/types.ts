export type PresentationSlideType =
  | "select_answer"
  | "type_answer"
  | "wordcloud"
  | "open_ended"
  | "scales"
  | "ranking";

export type QuizSlideType = PresentationSlideType;

export const SCORED_SLIDE_TYPES: PresentationSlideType[] = ["select_answer", "type_answer"];

export const isScoredSlideType = (type: PresentationSlideType) =>
  SCORED_SLIDE_TYPES.includes(type);

export type PresentationStatus =
  | "draft"
  | "lobby"
  | "question"
  | "reveal"
  | "leaderboard"
  | "ended";

export type QuizStatus = PresentationStatus;

export interface PresentationSlideOption {
  text: string;
  isCorrect: boolean;
}
export type QuizSlideOption = PresentationSlideOption;

export interface PresentationSlide {
  _id?: string;
  type: PresentationSlideType;
  question: string;
  // select_answer
  options: PresentationSlideOption[];
  // type_answer
  acceptedAnswers: string[];
  // scales
  statements: string[];
  minLabel: string;
  maxLabel: string;
  scaleMax: number;
  // ranking
  items: string[];
  // wordcloud
  maxEntries: number;
  timeLimit: number;
  points: number;
  scoreDependsOnTime: boolean;
}
export type QuizSlide = PresentationSlide;

export interface Presentation {
  _id: string;
  creatorId: string;
  title: string;
  joinCode: string;
  status: PresentationStatus;
  currentSlideIndex: number;
  questionStartedAt?: string | null;
  questionEndsAt?: string | null;
  slides: PresentationSlide[];
  createdAt: string;
  updatedAt: string;
}
export type Quiz = Presentation;

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

export type QuizRealtimeEventType = PresentationRealtimeEventType;

export interface PresentationRealtimeEvent {
  quizId: string;
  presentationId?: string;
  type: PresentationRealtimeEventType;
  payload: Record<string, unknown>;
  emittedAt: string;
}
export type QuizRealtimeEvent = PresentationRealtimeEvent;

export interface PresentationParticipantSelf {
  participantId: string;
  name: string;
  score: number;
  token: string;
  deviceToken: string;
}
export type QuizParticipantSelf = PresentationParticipantSelf;

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
export type PublicQuizInfo = PublicPresentationInfo;

// ---------- AI generation ----------

export interface GeneratePresentationInput {
  topic: string;
  slideCount: number;
  slideTypes: PresentationSlideType[];
  tone?: string;
}
export type GenerateQuizInput = GeneratePresentationInput;

export interface GeneratedPresentationDraft {
  title: string;
  slides: PresentationSlide[];
}
export type GeneratedQuizDraft = GeneratedPresentationDraft;
