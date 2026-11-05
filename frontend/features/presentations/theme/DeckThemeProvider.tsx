"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

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
  "qr-fg",
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

/** A deck is drawn light or dark. */
export type DeckMode = "light" | "dark";

/**
 * A resolved deck theme: light or dark (the Graph paper look of that mode,
 * `tokens.css`), CSS colour values keyed by token on top of it (unset tokens
 * keep the mode's), plus what colours can't carry: fonts, a logo and a stage
 * background picture (W3-A, from a session's theme snapshot).
 */
export interface DeckTheme {
  /** Without one the scope keeps the look from before modes (dark stage, phones follow the app). */
  mode?: DeckMode;
  tokens?: Partial<Record<DeckToken, string>>;
  /** CSS font stacks; `urls` are stylesheets to load (Google Fonts). */
  fonts?: { heading: string; body: string; urls: string[] };
  logo?: { url: string; alt: string } | null;
  background?: { imageUrl: string; overlayOpacity: number } | null;
}

const KNOWN = new Set<string>(DECK_TOKENS);

export function deckThemeStyle(theme?: DeckTheme | null): CSSProperties | undefined {
  const entries = Object.entries(theme?.tokens ?? {}).filter(
    ([token, value]) => KNOWN.has(token) && typeof value === "string" && value.trim() !== ""
  );
  const style: Record<string, string> = Object.fromEntries(entries.map(([token, value]) => [`--deck-${token}`, value as string]));
  if (theme?.fonts) {
    style.fontFamily = theme.fonts.body;
    style["--theme-font-heading"] = theme.fonts.heading;
  }
  return Object.keys(style).length ? (style as CSSProperties) : undefined;
}

const DeckThemeContext = createContext<DeckTheme | null>(null);

/** The theme of the nearest DeckThemeProvider: the logo and stage background read it. */
export const useDeckTheme = () => useContext(DeckThemeContext);

/**
 * Scopes a deck theme. Renders a `display: contents` element, so it adds no
 * box to the layout; it carries `data-deck-mode` (the light or dark look and
 * the app tokens of that mode, `tokens.css`, also for `dark:` utilities), and
 * everything inside reads the `--deck-*` variables (and the shadcn tokens
 * remapped to them) and inherits the theme's body font; headings take
 * `--theme-font-heading`. Without a theme the `:root` defaults apply.
 */
export function DeckThemeProvider({ theme, children }: { theme?: DeckTheme | null; children: ReactNode }) {
  return (
    <DeckThemeContext.Provider value={theme ?? null}>
      {(theme?.fonts?.urls ?? []).map((url) => (
        // React hoists stylesheets with a precedence into <head> and loads each once.
        <link key={url} rel="stylesheet" href={url} precedence="default" />
      ))}
      <div data-deck-theme="" data-deck-mode={theme?.mode} className="contents" style={deckThemeStyle(theme)}>
        {children}
      </div>
    </DeckThemeContext.Provider>
  );
}
