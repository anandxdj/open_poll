import type { LucideIcon } from "lucide-react";

import type { PresentationSlide, PresentationSlideType } from "../types/deck";
import { meta as big_number } from "./types/big_number/meta";
import { meta as bullets } from "./types/bullets/meta";
import { meta as grid_2x2 } from "./types/grid_2x2/meta";
import { meta as guess_number } from "./types/guess_number/meta";
import { meta as heading } from "./types/heading/meta";
import { meta as hundred_points } from "./types/hundred_points/meta";
import { meta as image } from "./types/image/meta";
import { meta as instructions } from "./types/instructions/meta";
import { meta as leaderboard } from "./types/leaderboard/meta";
import { meta as open_ended } from "./types/open_ended/meta";
import { meta as paragraph } from "./types/paragraph/meta";
import { meta as pin_on_image } from "./types/pin_on_image/meta";
import { meta as qna } from "./types/qna/meta";
import { meta as quote } from "./types/quote/meta";
import { meta as ranking } from "./types/ranking/meta";
import { meta as scales } from "./types/scales/meta";
import { meta as select_answer } from "./types/select_answer/meta";
import { meta as type_answer } from "./types/type_answer/meta";
import { meta as video } from "./types/video/meta";
import { meta as wordcloud } from "./types/wordcloud/meta";

// Light, static facts about each slide type. Safe to import from any surface
// (dashboard, builder, live stage, participant): no editor or runtime code.

/**
 * Picker grouping. `content` types are shown, not answered (no question, no
 * timer). `system` types are never offered in the "New slide" picker.
 */
export type SlideSection = "interactive" | "competition" | "advanced" | "content" | "system";

export interface SlideTypeMeta {
  type: PresentationSlideType;
  label: string;
  description: string;
  Icon: LucideIcon;
  /** Tailwind text color for the icon, Mentimeter-style colorful grid */
  iconClass: string;
  section: SlideSection;
  scored: boolean;
  /** Sort key inside pickers and type lists (lower first). */
  order: number;
  /** The slide's own text for lists (slide rail), for types without a question; "" when blank. */
  summary?: (slide: PresentationSlide) => string;
}

/** One line per slide type, alphabetical. */
export const SLIDE_META: Record<PresentationSlideType, SlideTypeMeta> = {
  big_number,
  bullets,
  grid_2x2,
  guess_number,
  heading,
  hundred_points,
  image,
  instructions,
  leaderboard,
  open_ended,
  paragraph,
  pin_on_image,
  qna,
  quote,
  ranking,
  scales,
  select_answer,
  type_answer,
  video,
  wordcloud,
};

/** Picker sections in display order. */
export const PICKER_SECTIONS: { id: Exclude<SlideSection, "system">; label: string }[] = [
  { id: "interactive", label: "Interactive slides" },
  { id: "competition", label: "Quiz competitions" },
  { id: "advanced", label: "Advanced slides" },
  { id: "content", label: "Content slides" },
];

/** Types an author can add from the builder, in display order. */
export const SLIDE_TYPE_META: SlideTypeMeta[] = Object.values(SLIDE_META)
  .filter((m) => m.section !== "system")
  .sort((a, b) => a.order - b.order);

/** Types the AI deck draft (`POST /api/ai/generate-quiz`) can produce, in display order. */
export const AI_SLIDE_TYPE_META: SlideTypeMeta[] = SLIDE_TYPE_META.filter(
  (m) => (m.section === "interactive" || m.section === "competition") && m.type !== "qna"
);

export const slideTypeMeta = (type: PresentationSlideType): SlideTypeMeta =>
  SLIDE_META[type] ?? SLIDE_META.select_answer;

export const slideMetaInSection = (section: SlideSection) =>
  SLIDE_TYPE_META.filter((m) => m.section === section);

/** Content slides are shown, not answered: no question, no timer, no scoring. */
export const isContentSlide = (type: PresentationSlideType) => slideTypeMeta(type).section === "content";

/** Name of one slide in lists: its question, else its own text, else the type label. */
export const slideLabel = (slide: PresentationSlide): string => {
  const meta = slideTypeMeta(slide.type);
  return slide.question.trim() || meta.summary?.(slide).trim() || meta.label;
};
