import type { Presentation } from "@/features/presentations/types/deck";

// Contract of `POST /api/ai/generate-deck` (backend/docs/wiki/modules/ai.md,
// "Whole-deck authoring"). Limits mirror `DECK_LIMITS` in the backend schema.

export const DECK_TONES = ["professional", "casual", "educational", "inspiring", "funny"] as const;
export type DeckTone = (typeof DECK_TONES)[number];

export const DECK_LIMITS = {
  minSlides: 3,
  maxSlides: 30,
  defaultSlides: 10,
  topicMin: 3,
  topicMax: 200,
  audienceMax: 200,
  languageMin: 2,
  languageMax: 40,
  sourceTextMax: 20_000,
  titleMax: 120,
  sectionTitleMax: 120,
  intentMax: 300,
} as const;

export const SLIDE_CATEGORIES = ["content", "polls", "quiz"] as const;
export type SlideCategory = (typeof SLIDE_CATEGORIES)[number];
export type DeckInclude = Record<SlideCategory, boolean>;

export interface DeckOutlineSlide {
  /** A deck kind (`DeckKindInfo.kind`), e.g. `bullets` or `multiple_choice_quiz`. */
  type: string;
  intent: string;
}

export interface DeckOutlineSection {
  title: string;
  slides: DeckOutlineSlide[];
}

export interface DeckOutline {
  title: string;
  sections: DeckOutlineSection[];
}

/** A kind the server can generate; `category` maps to the include toggles (`poll` is `polls`). */
export interface DeckKindInfo {
  kind: string;
  type: string;
  category: "content" | "poll" | "quiz";
}

export type DeckSource = "llm" | "mock";

export type DeckWarningCode =
  | "SLIDE_DROPPED"
  | "SLIDE_WITHOUT_NOTES"
  | "OUTLINE_SHORT"
  | "OUTLINE_TRIMMED"
  | "SOURCE_IGNORED";

export interface DeckWarning {
  code: DeckWarningCode;
  message: string;
  /** 1-based slide position, for slide warnings. */
  position?: number;
}

export interface DeckRequest {
  topic: string;
  audience: string;
  slideCount: number;
  tone: DeckTone;
  language: string;
  include: DeckInclude;
  sourceText: string;
  title?: string;
  step: "outline" | "deck";
  outline?: DeckOutline;
}

export interface DeckOutlineResponse {
  step: "outline";
  outline: DeckOutline;
  availableKinds: DeckKindInfo[];
  warnings: DeckWarning[];
  source: DeckSource;
}

export interface DeckUsage {
  counter: string;
  period: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  remaining: number | null;
}

export interface DeckCreatedResponse {
  step: "deck";
  /** The created draft deck, owner view (speaker notes included). */
  presentation: Presentation;
  outline: DeckOutline;
  warnings: DeckWarning[];
  source: DeckSource;
  /** The plan counter after this deck; null in mock mode (not counted). */
  usage: DeckUsage | null;
}

/** What went wrong, reduced to what the UI says about it. */
export type DeckErrorKind = "limit" | "rate" | "provider" | "empty" | "forbidden" | "invalid" | "network" | "unknown";

export interface DeckError {
  kind: DeckErrorKind;
  /** The server's message, when it sent one. */
  message?: string;
  /** For `limit`: the plan maximum. */
  max?: number;
}
