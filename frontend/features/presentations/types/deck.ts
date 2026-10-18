// Deck (authoring) types: what the builder edits and the CRUD API stores.
// Live-session types (participant/host state, reveal payloads, realtime
// events) stay in `../types.ts`.

export type PresentationSlideType =
  | "select_answer"
  | "type_answer"
  | "wordcloud"
  | "open_ended"
  | "scales"
  | "ranking"
  | "leaderboard";

export const SCORED_SLIDE_TYPES: PresentationSlideType[] = ["select_answer", "type_answer"];

export const isScoredSlideType = (type: PresentationSlideType) =>
  SCORED_SLIDE_TYPES.includes(type);

export type PresentationStatus = "draft" | "lobby" | "active" | "ended";

export interface PresentationSlideOption {
  text: string;
  isCorrect: boolean;
}

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

// ---------- AI generation ----------

export interface GeneratePresentationInput {
  topic: string;
  slideCount: number;
  slideTypes: PresentationSlideType[];
  tone?: string;
}

export interface GeneratedPresentationDraft {
  title: string;
  slides: PresentationSlide[];
}
