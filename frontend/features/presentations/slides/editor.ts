import type { ComponentType } from "react";

import type { PresentationSlide, PresentationSlideType } from "../types/deck";
import type { SlideTypeMeta } from "./meta";
import { editor as big_number } from "./types/big_number/editor";
import { editor as bullets } from "./types/bullets/editor";
import { editor as heading } from "./types/heading/editor";
import { editor as image } from "./types/image/editor";
import { editor as instructions } from "./types/instructions/editor";
import { editor as leaderboard } from "./types/leaderboard/editor";
import { editor as open_ended } from "./types/open_ended/editor";
import { editor as paragraph } from "./types/paragraph/editor";
import { editor as quote } from "./types/quote/editor";
import { editor as ranking } from "./types/ranking/editor";
import { editor as scales } from "./types/scales/editor";
import { editor as select_answer } from "./types/select_answer/editor";
import { editor as type_answer } from "./types/type_answer/editor";
import { editor as video } from "./types/video/editor";
import { editor as wordcloud } from "./types/wordcloud/editor";

// Builder-only slide registry. Live routes (participant, stage, host) must
// never import this module or a `types/<type>/editor.tsx`: they reach slide
// types through `runtime.ts` and `meta.ts`, so participants never download
// editor code.

export interface SlideEditorProps {
  slide: PresentationSlide;
  /** Shallow-merges the patch into the slide being edited. */
  onChange: (patch: Partial<PresentationSlide>) => void;
}

export interface SlideEditorDef {
  meta: SlideTypeMeta;
  /** A fresh slide of this type, as added from the "New slide" picker. */
  blank: () => PresentationSlide;
  /** Type-specific fields, rendered in the inspector's Content tab under the question. */
  Editor: ComponentType<SlideEditorProps>;
  /**
   * Error for a slide that cannot be saved, or null. Runs on a cleaned slide.
   * The message is lowercase and unprefixed; the deck validator adds "Slide N: ".
   */
  validate: (slide: PresentationSlide) => string | null;
  /** Drops blank entries and clears fields that belong to other slide types. */
  clean: (slide: PresentationSlide) => PresentationSlide;
  /**
   * Fills the gaps of a cleaned slide (question already set) so an unfinished
   * deck still passes the API's rules when it is saved as a draft.
   */
  fillDraft: (slide: PresentationSlide) => PresentationSlide;
}

/** One line per slide type, alphabetical. */
export const SLIDE_EDITORS: Record<PresentationSlideType, SlideEditorDef> = {
  big_number,
  bullets,
  heading,
  image,
  instructions,
  leaderboard,
  open_ended,
  paragraph,
  quote,
  ranking,
  scales,
  select_answer,
  type_answer,
  video,
  wordcloud,
};

export const getSlideEditor = (type: PresentationSlideType): SlideEditorDef =>
  SLIDE_EDITORS[type] ?? SLIDE_EDITORS.select_answer;

export const blankSlide = (type: PresentationSlideType = "select_answer"): PresentationSlide =>
  getSlideEditor(type).blank();

export const cleanSlide = (slide: PresentationSlide): PresentationSlide =>
  getSlideEditor(slide.type).clean(slide);

export const validateSlide = (slide: PresentationSlide): string | null =>
  getSlideEditor(slide.type).validate(slide);

// Fills gaps instead of rejecting, so an in-progress deck can still be
// persisted as a backend draft (passes the same strict Zod rules as a real
// save) — mirrors the poll builder's save-as-draft normalization.
export function normalizeSlideForDraft(slide: PresentationSlide): PresentationSlide {
  const def = getSlideEditor(slide.type);
  const cleaned = def.clean(slide);
  return def.fillDraft({ ...cleaned, question: cleaned.question || "Untitled Question" });
}
