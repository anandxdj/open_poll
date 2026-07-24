import {
  Cloud,
  Keyboard,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

import type { PresentationSlideType } from "./types";

export interface SlideTypeMeta {
  type: PresentationSlideType;
  label: string;
  description: string;
  Icon: LucideIcon;
  /** Tailwind text color for the icon, Mentimeter-style colorful grid */
  iconClass: string;
  section: "interactive" | "competition";
  scored: boolean;
}

export const SLIDE_TYPE_META: SlideTypeMeta[] = [
  {
    type: "select_answer",
    label: "Select Answer",
    description: "Scored multiple choice — fastest correct answer wins",
    Icon: ListChecks,
    iconClass: "text-indigo-400",
    section: "competition",
    scored: true,
  },
  {
    type: "type_answer",
    label: "Type Answer",
    description: "Scored free text matched against accepted answers",
    Icon: Keyboard,
    iconClass: "text-emerald-400",
    section: "competition",
    scored: true,
  },
  {
    type: "wordcloud",
    label: "Word Cloud",
    description: "Collect words that grow with every repeat",
    Icon: Cloud,
    iconClass: "text-rose-400",
    section: "interactive",
    scored: false,
  },
  {
    type: "open_ended",
    label: "Open Ended",
    description: "Free-form responses shown as a card wall",
    Icon: MessageSquareText,
    iconClass: "text-pink-400",
    section: "interactive",
    scored: false,
  },
  {
    type: "scales",
    label: "Scales",
    description: "Rate statements on a slider, see live averages",
    Icon: SlidersHorizontal,
    iconClass: "text-violet-400",
    section: "interactive",
    scored: false,
  },
  {
    type: "ranking",
    label: "Ranking",
    description: "Order items — combined ranking at reveal",
    Icon: ListOrdered,
    iconClass: "text-green-400",
    section: "interactive",
    scored: false,
  },
];

export const slideTypeMeta = (type: PresentationSlideType) =>
  SLIDE_TYPE_META.find((m) => m.type === type) ?? SLIDE_TYPE_META[0];
