export type QuizSlideType = "select_answer" | "type_answer";

export type QuizStatus =
  | "draft"
  | "lobby"
  | "question"
  | "reveal"
  | "leaderboard"
  | "ended";

export interface QuizSlideOption {
  text: string;
  isCorrect: boolean;
}

export interface QuizSlide {
  _id?: string;
  type: QuizSlideType;
  question: string;
  options: QuizSlideOption[];
  acceptedAnswers: string[];
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
  question: string;
  options: { text: string }[];
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
    };

export interface RevealPayload {
  slideIndex: number;
  question: string;
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
}

export interface ParticipantState {
  participantId: string;
  name: string;
  totalScore: number;
  correctCount: number;
  rank: number;
  lastAnswer: { slideIndex: number; isCorrect: boolean; score: number } | null;
  quizStatus: QuizStatus;
}

export interface HostState {
  quiz: Quiz;
  serverNow: string;
  participants: { participantId: string; name: string; score: number }[];
  answeredCount: number;
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
