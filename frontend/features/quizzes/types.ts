export type QuizSlideType =
  | "select_answer"
  | "type_answer"
  | "wordcloud"
  | "open_ended"
  | "scales"
  | "ranking"
  | "leaderboard";

export const SCORED_SLIDE_TYPES: QuizSlideType[] = ["select_answer", "type_answer"];

export const isScoredSlideType = (type: QuizSlideType) =>
  SCORED_SLIDE_TYPES.includes(type);

export type QuizStatus = "draft" | "lobby" | "active" | "ended";

export interface QuizSlideOption {
  text: string;
  isCorrect: boolean;
}

export interface QuizSlide {
  _id?: string;
  type: QuizSlideType;
  question: string;
  // select_answer
  options: QuizSlideOption[];
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

export interface Quiz {
  _id: string;
  creatorId: string;
  title: string;
  joinCode: string;
  status: QuizStatus;
  currentSlideIndex: number;
  questionStartedAt?: string | null;
  questionEndsAt?: string | null;
  slides: QuizSlide[];
  createdAt: string;
  updatedAt: string;
}

/** Slide as broadcast to participants — answer keys stripped */
export interface LiveSlide {
  slideIndex: number;
  totalSlides: number;
  type: QuizSlideType;
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
  type: QuizSlideType;
  scored: boolean;
  distribution: RevealDistribution;
  answeredCount: number;
  participantCount: number;
  isLastSlide: boolean;
}

export type QuizRealtimeEventType =
  | "lobby:opened"
  | "participant:joined"
  | "question:started"
  | "answer:received"
  | "question:revealed"
  | "leaderboard:shown"
  | "quiz:ended";

export interface QuizRealtimeEvent {
  quizId: string;
  type: QuizRealtimeEventType;
  // payload shape depends on `type` — narrowed at the consumer
  payload: Record<string, unknown>;
  emittedAt: string;
}

export interface QuizParticipantSelf {
  participantId: string;
  name: string;
  score: number;
  /** Secret credential for answering — stored locally, never shared */
  token: string;
  /** Server-signed device identity — presented on rejoin after a refresh */
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
  quizStatus: QuizStatus;
}

export interface HostState {
  quiz: Quiz;
  serverNow: string;
  participants: { participantId: string; name: string; score: number }[];
  answeredCount: number;
  liveDistribution?: RevealDistribution | null;
  leaderboard: LeaderboardEntry[];
}

export interface PublicQuizInfo {
  quizId: string;
  title: string;
  status: QuizStatus;
  totalSlides: number;
  currentSlideIndex: number;
  serverNow: string;
  currentSlide?: LiveSlide;
  questionStartedAt?: string;
  questionEndsAt?: string;
}

// ---------- AI generation ----------

export interface GenerateQuizInput {
  topic: string;
  slideCount: number;
  slideTypes: QuizSlideType[];
  tone?: string;
}

export interface GeneratedQuizDraft {
  title: string;
  slides: QuizSlide[];
}
