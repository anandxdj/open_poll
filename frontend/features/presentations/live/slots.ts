"use client";

import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import type { LiveRole } from "./reducer";

/**
 * Named extension points of the live surfaces. A feature module registers a
 * component into a slot (usually from its `register` file, imported by
 * `features/registrations.ts`); the surface renders every matching entry in
 * `order`. With nothing registered a slot renders nothing — no wrapper markup.
 *
 * Slot components may read the surrounding live store with `useLive`, so
 * props carry only what the store does not know. The props interfaces are
 * open: a module can augment one with `declare module`.
 *
 * Builder inspector tabs are not a live slot: they have their own registry
 * in `components/builder/inspectorTabs.ts`.
 */
export interface ParticipantSlotProps {
  presentationId: string;
  participantId: string;
}

export interface StageSlotProps {
  /** Which surface hosts the stage: the host console or an audience screen. */
  surface: "host" | "screen";
  presentationId: string;
}

export interface HostSlotProps {
  presentationId: string;
}

export interface EndScreenSlotProps {
  role: LiveRole;
  presentationId: string;
}

export interface LiveSlotProps {
  /** Extra participant tabs next to the built-in slide tab; a tab bar appears once one exists. */
  participantTabs: ParticipantSlotProps;
  /** Under the participant main area (e.g. reactions bar). */
  participantFooter: ParticipantSlotProps;
  /** Above the participant main area (e.g. offline / "saved, will sync"). */
  participantBanner: ParticipantSlotProps;
  /** Replaces the participant slide body; the first entry whose `when` matches wins. */
  participantBody: ParticipantSlotProps;
  /** Appended to the end screen of the host and the participant. */
  endScreen: EndScreenSlotProps;
  /** Absolutely positioned layers over the stage (Q&A highlight, reactions). */
  stageOverlays: StageSlotProps;
  /** Side panels of the presenter console. */
  presenterPanels: HostSlotProps;
  /** Buttons in the host console header, before the built-in ones. */
  hostToolbar: HostSlotProps;
}

export type SlotName = keyof LiveSlotProps;

export const SLOT_NAMES = [
  "participantTabs",
  "participantFooter",
  "participantBanner",
  "participantBody",
  "endScreen",
  "stageOverlays",
  "presenterPanels",
  "hostToolbar",
] as const satisfies readonly SlotName[];

export interface SlotEntry<P> {
  /** Unique within the slot; registering the same id again replaces the entry. */
  id: string;
  /** Ascending; default 100. */
  order?: number;
  /** Tab slots: the tab label. */
  label?: string;
  /** Tab slots: optional icon. */
  icon?: ComponentType<{ className?: string }>;
  /** Render only when this returns true. */
  when?: (props: P) => boolean;
  Component: ComponentType<P>;
}

type Registry = { [N in SlotName]: SlotEntry<LiveSlotProps[N]>[] };

const registry: Registry = {
  participantTabs: [],
  participantFooter: [],
  participantBanner: [],
  participantBody: [],
  endScreen: [],
  stageOverlays: [],
  presenterPanels: [],
  hostToolbar: [],
};

const DEFAULT_ORDER = 100;
const byOrder = <P>(a: SlotEntry<P>, b: SlotEntry<P>) =>
  (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER);

/** Registers `entry` into `slot`. Returns an unregister function. */
export function registerSlot<N extends SlotName>(slot: N, entry: SlotEntry<LiveSlotProps[N]>): () => void {
  const entries = registry[slot] as SlotEntry<LiveSlotProps[N]>[];
  const existing = entries.findIndex((e) => e.id === entry.id);
  if (existing >= 0) entries.splice(existing, 1);
  entries.push(entry);
  entries.sort(byOrder);
  return () => {
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
  };
}

/** Every entry of `slot` in order; with `props`, only those whose `when` matches. */
export function getSlotEntries<N extends SlotName>(
  slot: N,
  props?: LiveSlotProps[N]
): readonly SlotEntry<LiveSlotProps[N]>[] {
  const entries = registry[slot] as SlotEntry<LiveSlotProps[N]>[];
  if (!props) return entries.slice();
  return entries.filter((e) => !e.when || e.when(props));
}

/**
 * Renders every matching entry of a slot, in order, with no wrapper element.
 * Registrations happen at import time, before the first render, so the list
 * is read during render rather than subscribed to.
 */
export function SlotOutlet<N extends SlotName>({
  name,
  props,
}: {
  name: N;
  props: LiveSlotProps[N];
}): ReactNode {
  const entries = getSlotEntries(name, props);
  if (entries.length === 0) return null;
  return createElement(
    Fragment,
    null,
    entries.map(({ id, Component }) =>
      // Component props are the slot's props; `key` is added by createElement.
      createElement(Component as ComponentType<object>, { key: id, ...props })
    )
  );
}
