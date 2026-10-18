"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * Token names of `theme/tokens.css`, without the `--deck-` prefix. Kept in
 * sync by hand: a theme may override any subset.
 */
export const DECK_TOKENS = [
  "bg",
  "fg",
  "surface",
  "secondary",
  "muted-fg",
  "border",
  "input",
  "ring",
  "primary",
  "primary-fg",
  "stage-bg",
  "stage-chrome",
  "stage-panel",
  "stage-fg",
  "stage-scrim",
  "stage-ink",
  "qr-bg",
  "accent",
  "accent-strong",
  "accent-soft",
  "correct",
  "correct-soft",
  "correct-deep",
  "correct-alt",
  "live",
  "danger",
  "danger-strong",
  "danger-soft",
  "wrong",
  "info",
  "bar",
  "rank-1",
  "rank-2",
  "rank-3",
  "glow-correct",
  "glow-accent",
  "cloud-1",
  "cloud-2",
  "cloud-3",
  "cloud-4",
  "cloud-5",
  "cloud-6",
  "cloud-7",
  "cloud-8",
  "cloud-9",
  "cloud-10",
  "cloud-11",
  "cloud-12",
] as const;

export type DeckToken = (typeof DECK_TOKENS)[number];

/** A resolved deck theme: CSS colour values keyed by token. Unset tokens keep the defaults. */
export interface DeckTheme {
  tokens?: Partial<Record<DeckToken, string>>;
}

const KNOWN = new Set<string>(DECK_TOKENS);

export function deckThemeStyle(theme?: DeckTheme | null): CSSProperties | undefined {
  const entries = Object.entries(theme?.tokens ?? {}).filter(
    ([token, value]) => KNOWN.has(token) && typeof value === "string" && value.trim() !== ""
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([token, value]) => [`--deck-${token}`, value])) as CSSProperties;
}

/**
 * Scopes a deck theme. Renders a `display: contents` element, so it adds no
 * box to the layout; everything inside reads the `--deck-*` variables (and
 * the shadcn tokens remapped to them). Without a theme the defaults apply,
 * which reproduce the built-in look.
 */
export function DeckThemeProvider({ theme, children }: { theme?: DeckTheme | null; children: ReactNode }) {
  return (
    <div data-deck-theme="" className="contents" style={deckThemeStyle(theme)}>
      {children}
    </div>
  );
}
