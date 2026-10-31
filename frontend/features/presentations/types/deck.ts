// Deck (authoring) types: what the builder edits and the CRUD API stores.
// Live-session types (participant/host state, reveal payloads, realtime
// events) stay in `../types.ts`.

import type { ContentSlideType, SlideContent } from "./content";
import type { DeckThemeRef } from "@/features/themes/types";

export type PresentationSlideType =
  | "select_answer"
  | "type_answer"
  | "wordcloud"
  | "open_ended"
  | "scales"
  | "ranking"
  | "leaderboard"
  | "guess_number"
  | "hundred_points"
  | "grid_2x2"
  | "pin_on_image"
  | "qna"
  | ContentSlideType;

/**
 * Types that can award points. `guess_number` and `pin_on_image` only do so
 * while a correct value / area is set and the slide is worth points.
 */
export const SCORED_SLIDE_TYPES: PresentationSlideType[] = [
  "select_answer",
  "type_answer",
  "guess_number",
  "pin_on_image",
];

export const isScoredSlideType = (type: PresentationSlideType) =>
  SCORED_SLIDE_TYPES.includes(type);

export type PresentationStatus = "draft" | "lobby" | "active" | "ended";

export interface PresentationSlideOption {
  text: string;
  isCorrect: boolean;
}

/**
 * select_answer settings, stored in `slide.config` (null or absent on slides
 * saved before them; read them with `selectAnswerConfig`).
 */
export type SelectAnswerConfig = {
  /** Participants pick one or more options; correct = exactly the correct set. */
  allowMultiple: boolean;
  /** Why the answer is right; shown on the stage after the reveal, never sent to participants. */
  explanation: string;
};

/**
 * `slide.config` of the registry types: select_answer's settings, or the
 * type's own object for guess_number, hundred_points, grid_2x2 and
 * pin_on_image (read them with the defensive readers in
 * `slides/types/<type>/config.ts`).
 */
export type SlideConfig = Partial<SelectAnswerConfig> & Record<string, unknown>;

/**
 * The image of a pin_on_image slide (`slide.content`): an upload `key` (the
 * server pins `url` to it) or a pasted https `url`; `alt` is required.
 */
export interface PinImageContent {
  key: string | null;
  url: string | null;
  alt: string;
}

export interface PresentationSlide {
  _id?: string;
  type: PresentationSlideType;
  question: string;
  // select_answer (worth 0 points = ungraded: no correct option, results only)
  options: PresentationSlideOption[];
  config?: SlideConfig | null;
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
  /**
   * Content slide types: the type's payload (`./content.ts`). pin_on_image
   * keeps its image here (`{key, url, alt}`). Absent or null for the others.
   */
  content?: SlideContent | PinImageContent | null;
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
  /** Preset, brand kit and accent override (W3-A); sessions snapshot the resolved look. */
  theme?: DeckThemeRef;
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
