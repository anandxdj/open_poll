import type { DeckTheme, DeckToken } from "@/features/presentations/theme/DeckThemeProvider";
import type { ThemeTokens } from "./types";

/**
 * A session's theme snapshot as live surfaces draw it. The stage takes the
 * whole palette; audience phones keep following the app's light or dark
 * theme and only take the accent for their main buttons, so answers stay
 * readable on any phone. The built-in look (`custom: false`) maps to no
 * overrides at all.
 */
export function deckThemeFrom(tokens: ThemeTokens | null | undefined): DeckTheme | null {
  if (!tokens || !tokens.custom) return null;
  const c = tokens.colors;
  const chart = c.chart.length ? c.chart : [c.accent];
  const cloud = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`cloud-${i + 1}`, chart[i % chart.length]!])
  ) as Partial<Record<DeckToken, string>>;

  const fontUrls = [tokens.fonts.heading.url, tokens.fonts.body.url].filter((url): url is string => Boolean(url));
  return {
    tokens: {
      "stage-bg": c.background,
      "stage-chrome": c.surface,
      "stage-panel": c.surface,
      "stage-fg": c.text,
      "stage-ink": c.accentText,
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
      ring: c.accent,
      ...cloud,
    },
    fonts: { heading: tokens.fonts.heading.family, body: tokens.fonts.body.family, urls: [...new Set(fontUrls)] },
    logo: tokens.logo,
    background: tokens.background,
  };
}
