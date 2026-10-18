import type { LucideIcon } from "lucide-react";

import type { PresentationSlideType } from "../types/deck";
import { meta as leaderboard } from "./types/leaderboard/meta";
import { meta as open_ended } from "./types/open_ended/meta";
import { meta as ranking } from "./types/ranking/meta";
import { meta as scales } from "./types/scales/meta";
import { meta as select_answer } from "./types/select_answer/meta";
import { meta as type_answer } from "./types/type_answer/meta";
import { meta as wordcloud } from "./types/wordcloud/meta";

// Light, static facts about each slide type. Safe to import from any surface
// (dashboard, builder, live stage, participant): no editor or runtime code.

/** Picker grouping. `system` types are never offered in the "New slide" picker. */
export type SlideSection = "interactive" | "competition" | "system";

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
}

/** One line per slide type, alphabetical. */
export const SLIDE_META: Record<PresentationSlideType, SlideTypeMeta> = {
  leaderboard,
  open_ended,
  ranking,
  scales,
  select_answer,
  type_answer,
  wordcloud,
};

/** Picker sections in display order. */
export const PICKER_SECTIONS: { id: Exclude<SlideSection, "system">; label: string }[] = [
  { id: "interactive", label: "Interactive slides" },
  { id: "competition", label: "Quiz competitions" },
];

/** Types an author can add from the builder or ask the AI for, in display order. */
export const SLIDE_TYPE_META: SlideTypeMeta[] = Object.values(SLIDE_META)
  .filter((m) => m.section !== "system")
  .sort((a, b) => a.order - b.order);

export const slideTypeMeta = (type: PresentationSlideType): SlideTypeMeta =>
  SLIDE_META[type] ?? SLIDE_META.select_answer;

export const slideMetaInSection = (section: SlideSection) =>
  SLIDE_TYPE_META.filter((m) => m.section === section);
