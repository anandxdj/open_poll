/**
 * Resolves a deck's theme reference into the tokens every live surface renders
 * with (`--deck-*` CSS variables on the frontend). Sessions snapshot the result
 * when they open, so a later theme edit never restyles a past session's report.
 *
 * Presets only for now: brand kits and per-deck overrides are layered on top by
 * the themes module (W3-A), which replaces this file behind the same signature.
 */

export interface ThemeFont {
  family: string;
  /** `system` fonts need no download; `google` and `upload` load from `url`. */
  source: 'system' | 'google' | 'upload';
  url: string | null;
}

export interface ThemeTokens {
  presetId: string;
  colors: {
    background: string;
    surface: string;
    text: string;
    mutedText: string;
    accent: string;
    accentText: string;
    correct: string;
    incorrect: string;
    /** Series colours for result charts, in order. */
    chart: string[];
  };
  fonts: { heading: ThemeFont; body: ThemeFont };
  logo: { url: string; alt: string } | null;
  background: { imageUrl: string; overlayOpacity: number } | null;
}

export interface ThemeRef {
  presetId?: string | null;
  brandKitId?: unknown;
  overrides?: unknown;
}

export const DEFAULT_THEME_PRESET = 'amber';

const SYSTEM_SANS: ThemeFont = {
  family: 'Inter, ui-sans-serif, system-ui, sans-serif',
  source: 'system',
  url: null,
};

const PRESETS: Record<string, ThemeTokens> = {
  // The current live look: near-black stage, amber accent.
  amber: {
    presetId: 'amber',
    colors: {
      background: '#050505',
      surface: '#0d0d0d',
      text: '#fafafa',
      mutedText: '#a1a1aa',
      accent: '#fbbf24',
      accentText: '#0a0a0a',
      correct: '#22c55e',
      incorrect: '#ef4444',
      chart: ['#fbbf24', '#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#f87171', '#facc15'],
    },
    fonts: { heading: SYSTEM_SANS, body: SYSTEM_SANS },
    logo: null,
    background: null,
  },
};

export const listThemePresetIds = (): string[] => Object.keys(PRESETS);

/** Tokens for a deck's theme; unknown presets fall back to the default preset. */
export const resolveTheme = async (ref: ThemeRef | null | undefined): Promise<ThemeTokens> => {
  const preset = (ref?.presetId && PRESETS[ref.presetId]) || PRESETS[DEFAULT_THEME_PRESET]!;
  return structuredClone(preset);
};
