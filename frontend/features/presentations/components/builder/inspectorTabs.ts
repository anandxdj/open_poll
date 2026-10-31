import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import { audienceTab } from "@/features/qna/builder/AudienceTab";
import { themeTab } from "@/features/themes/components/ThemeTab";
import type { PresentationSlide } from "../../types/deck";
import type { DeckDraft } from "./deckDraft";
import { contentTab } from "./tabs/ContentTab";
import { settingsTab } from "./tabs/SettingsTab";

// Inspector tab registry. A feature adds a tab by exporting an
// `InspectorTabDef` and adding one line to INSPECTOR_TABS; `order` sets where
// it shows up, `appliesTo` hides it for slides it doesn't fit.

export interface InspectorTabProps {
  slide: PresentationSlide;
  /** Position of `slide` in the deck (0-based). */
  index: number;
  /** Shallow-merges the patch into `slide`. */
  onChange: (patch: Partial<PresentationSlide>) => void;
  /** The whole deck, for deck-level tabs. */
  deck: DeckDraft;
  /** Shallow-merges deck-level fields (everything except the slide list). */
  onDeckChange: (patch: Partial<Omit<DeckDraft, "slides">>) => void;
}

export interface InspectorTabDef {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Tab position, lower first. Content is 10, Settings 20. */
  order: number;
  /** Defaults to every slide. */
  appliesTo?: (slide: PresentationSlide) => boolean;
  Panel: ComponentType<InspectorTabProps>;
}

/** One line per tab, alphabetical. */
export const INSPECTOR_TABS: InspectorTabDef[] = [
  audienceTab,
  contentTab,
  settingsTab,
  themeTab,
];

export const inspectorTabsFor = (slide: PresentationSlide): InspectorTabDef[] =>
  INSPECTOR_TABS.filter((tab) => !tab.appliesTo || tab.appliesTo(slide)).sort((a, b) => a.order - b.order);
