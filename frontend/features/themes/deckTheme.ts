import type { DeckTheme, DeckToken } from "@/features/presentations/theme/DeckThemeProvider";
import type { DeckCardTheme, ThemeMode, ThemeTokens } from "./types";

/**
 * A resolved theme (a session's snapshot, a deck's current theme) as every
 * deck surface draws it: the stage, the phones, the builder canvas.
 *
 * - `mode` picks the Graph paper look of light or dark (`tokens.css`).
 *   Snapshots from before modes carry none: their stages were all dark, so
 *   they stay dark.
 * - The built-in look (`custom: false`) adds nothing on top of the mode.
 * - A custom theme (another preset, a brand kit, an accent) colours the stage
 *   and the phones with its palette: background, panels, text, muted text,
 *   the accent and the text on it, correct and wrong, and `cloud-1..12` from
 *   its chart colours. Every built-in palette passes the API's contrast
 *   checks in both modes.
 */
export function deckThemeFrom(tokens: ThemeTokens | null | undefined): DeckTheme | null {
  if (!tokens) return null;
  const mode: ThemeMode = tokens.mode ?? "dark";
  if (!tokens.custom) return { mode };

  const c = tokens.colors;
  const chart = c.chart.length ? c.chart : [c.accent];
  const cloud = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`cloud-${i + 1}`, chart[i % chart.length]!])
  ) as Partial<Record<DeckToken, string>>;
  const mix = (share: number, base: string) => `color-mix(in srgb, ${c.text} ${share}%, ${base})`;

  const fontUrls = [tokens.fonts.heading.url, tokens.fonts.body.url].filter((url): url is string => Boolean(url));
  return {
    mode,
    tokens: {
      // Stage
      "stage-bg": c.background,
      "stage-chrome": c.surface,
      "stage-panel": c.surface,
      "stage-fg": c.text,
      "stage-muted": c.mutedText,
      "stage-ink": c.accentText,
      // Phones and the app primitives inside the deck
      bg: c.background,
      fg: c.text,
      surface: c.surface,
      secondary: mix(7, c.surface),
      "muted-fg": c.mutedText,
      border: mix(14, c.background),
      input: mix(45, c.background),
      // Accent, correct, wrong
      accent: c.accent,
      "accent-strong": c.accent,
      "accent-soft": `color-mix(in srgb, ${c.accent} 82%, ${c.text})`,
      bar: c.accent,
      "glow-accent": c.accent,
      correct: c.correct,
      "correct-soft": c.correct,
      "correct-alt": c.correct,
      live: c.correct,
      "glow-correct": c.correct,
      wrong: c.incorrect,
      danger: c.incorrect,
      "danger-soft": c.incorrect,
      "danger-strong": c.incorrect,
      primary: c.accent,
      "primary-fg": c.accentText,
      // The accent as text on the phones: pulled toward the text colour like `accent-soft`.
      "primary-ink": `color-mix(in srgb, ${c.accent} 75%, ${c.text})`,
      ring: c.accent,
      ...cloud,
    },
    fonts: { heading: tokens.fonts.heading.family, body: tokens.fonts.body.family, urls: [...new Set(fontUrls)] },
    logo: tokens.logo,
    background: tokens.background,
  };
}

/** A library card's theme preview as a deck scope (the card's mini screen uses the stage tokens). */
export function deckThemeFromCard(card: DeckCardTheme | null | undefined): DeckTheme | null {
  if (!card) return null;
  if (!card.custom) return { mode: card.mode };
  return {
    mode: card.mode,
    tokens: {
      "stage-bg": card.background,
      "stage-chrome": card.surface,
      "stage-panel": card.surface,
      "stage-fg": card.text,
      "stage-muted": card.mutedText,
      "stage-ink": card.accentText,
      accent: card.accent,
    },
  };
}
