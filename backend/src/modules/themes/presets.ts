import type { FontChoice } from './fonts';
import type { ThemeColors } from './resolve';

/**
 * A deck is drawn light or dark. Every preset has a palette for each; a brand
 * kit has one palette, so its mode follows from its own background.
 */
export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * The mode of a deck that stores none (decks from before modes that chose no
 * look, MCP/API decks that send none): light, like the app.
 */
export const DEFAULT_THEME_MODE: ThemeMode = 'light';

export interface ThemePreset {
  id: string;
  name: string;
  /** One palette per mode; both pass `contrastFailures` and `chartContrastFailures` (tested). */
  palettes: Record<ThemeMode, ThemeColors>;
  fonts: { heading: FontChoice; body: FontChoice };
}

/** The Graph paper look the live surfaces draw without a theme. */
export const DEFAULT_THEME_PRESET = 'graph-paper';

/** Ids decks stored before the presets were renamed. */
const PRESET_ALIASES: Record<string, string> = { amber: DEFAULT_THEME_PRESET };

/** Word cloud and chart hues every dark stage can use (the app's categorical order, 400 steps). */
const CHART_DARK = [
  '#fb923c', '#60a5fa', '#4ade80', '#a78bfa', '#f472b6', '#22d3ee',
  '#fbbf24', '#2dd4bf', '#e879f9', '#a3e635', '#fdba74', '#93c5fd',
];

/**
 * The same order on a light stage: 700/800 steps, so every word of a cloud and
 * every bar reads at 4.5:1 or better on paper and white.
 */
const CHART_LIGHT = [
  '#c2410c', '#1d4ed8', '#15803d', '#6d28d9', '#be185d', '#0e7490',
  '#a16207', '#0f766e', '#a21caf', '#4d7c0f', '#9a3412', '#1e40af',
];

/**
 * Built-in themes, each with a light and a dark palette and its own accent.
 * Light is the app's default (Graph paper is light-first); a dark stage still
 * suits a dim room or a projector that washes out light colours.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: DEFAULT_THEME_PRESET,
    name: 'Graph paper',
    palettes: {
      // The app's light tokens (frontend app/globals.css): warm paper, white sheets, ink, ember.
      light: {
        background: '#f6f6f3',
        surface: '#ffffff',
        text: '#171717',
        mutedText: '#5c5a55',
        accent: '#cf460c',
        accentText: '#ffffff',
        correct: '#15803d',
        incorrect: '#c81e1e',
        chart: CHART_LIGHT,
      },
      dark: {
        background: '#141413',
        surface: '#1f1f1d',
        text: '#f2f1ec',
        mutedText: '#a8a49c',
        accent: '#f97316',
        accentText: '#1a0d04',
        correct: '#22c55e',
        incorrect: '#f87171',
        chart: CHART_DARK,
      },
    },
    fonts: { heading: 'System', body: 'System' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    palettes: {
      light: {
        background: '#f1f6fa',
        surface: '#ffffff',
        text: '#0b1a2a',
        mutedText: '#4a5d70',
        accent: '#0369a1',
        accentText: '#ffffff',
        correct: '#047857',
        incorrect: '#be123c',
        chart: ['#0369a1', '#6d28d9', '#047857', '#b45309', '#be185d', '#0e7490', '#c2410c', '#4d7c0f', '#a21caf', '#1d4ed8', '#a16207', '#0f766e'],
      },
      dark: {
        background: '#0b1622',
        surface: '#132233',
        text: '#eef4fa',
        mutedText: '#9fb3c8',
        accent: '#38bdf8',
        accentText: '#04202f',
        correct: '#34d399',
        incorrect: '#fb7185',
        chart: ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c', '#a3e635', '#e879f9', '#60a5fa', '#facc15', '#2dd4bf'],
      },
    },
    fonts: { heading: 'DM Sans', body: 'DM Sans' },
  },
  {
    id: 'forest',
    name: 'Forest',
    palettes: {
      light: {
        background: '#f2f6f1',
        surface: '#ffffff',
        text: '#102017',
        mutedText: '#4a5d4f',
        accent: '#15803d',
        accentText: '#ffffff',
        correct: '#166534',
        incorrect: '#b91c1c',
        chart: ['#15803d', '#a16207', '#0369a1', '#c2410c', '#7e22ce', '#0f766e', '#be185d', '#4d7c0f', '#1d4ed8', '#9a3412', '#a21caf', '#1e40af'],
      },
      dark: {
        background: '#0f1a14',
        surface: '#17251d',
        text: '#eef5ef',
        mutedText: '#a3b8a8',
        accent: '#4ade80',
        accentText: '#052e16',
        correct: '#86efac',
        incorrect: '#fca5a5',
        chart: ['#4ade80', '#facc15', '#38bdf8', '#fb923c', '#c084fc', '#2dd4bf', '#f472b6', '#a3e635', '#60a5fa', '#fdba74', '#e879f9', '#93c5fd'],
      },
    },
    fonts: { heading: 'Nunito', body: 'Nunito' },
  },
  {
    id: 'grape',
    name: 'Grape',
    palettes: {
      light: {
        background: '#f7f4fa',
        surface: '#ffffff',
        text: '#1d1428',
        mutedText: '#5c5169',
        accent: '#7e22ce',
        accentText: '#ffffff',
        correct: '#15803d',
        incorrect: '#be123c',
        chart: ['#7e22ce', '#be185d', '#0369a1', '#a16207', '#15803d', '#c2410c', '#0e7490', '#4d7c0f', '#a21caf', '#1d4ed8', '#9a3412', '#0f766e'],
      },
      dark: {
        background: '#17121f',
        surface: '#221a2d',
        text: '#f4f0fa',
        mutedText: '#b3a8c4',
        accent: '#c084fc',
        accentText: '#24083f',
        correct: '#4ade80',
        incorrect: '#fb7185',
        chart: ['#c084fc', '#f472b6', '#38bdf8', '#facc15', '#4ade80', '#fb923c', '#22d3ee', '#a3e635', '#e879f9', '#60a5fa', '#fdba74', '#2dd4bf'],
      },
    },
    fonts: { heading: 'Poppins', body: 'Poppins' },
  },
  {
    id: 'mono',
    name: 'Mono',
    palettes: {
      light: {
        background: '#f5f5f4',
        surface: '#ffffff',
        text: '#111111',
        mutedText: '#525252',
        accent: '#171717',
        accentText: '#fafafa',
        correct: '#15803d',
        incorrect: '#b91c1c',
        chart: CHART_LIGHT,
      },
      dark: {
        background: '#111111',
        surface: '#1c1c1c',
        text: '#f5f5f5',
        mutedText: '#a3a3a3',
        accent: '#f5f5f5',
        accentText: '#111111',
        correct: '#4ade80',
        incorrect: '#f87171',
        chart: CHART_DARK,
      },
    },
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
  },
  {
    id: 'classic',
    name: 'Classic',
    palettes: {
      light: {
        background: '#f8f5ec',
        surface: '#fffdf7',
        text: '#1c1a14',
        mutedText: '#5c574a',
        accent: '#92400e',
        accentText: '#ffffff',
        correct: '#15803d',
        incorrect: '#b91c1c',
        chart: ['#a16207', '#1d4ed8', '#15803d', '#6d28d9', '#be185d', '#0e7490', '#c2410c', '#0f766e', '#a21caf', '#4d7c0f', '#9a3412', '#1e40af'],
      },
      dark: {
        background: '#14161c',
        surface: '#1d2029',
        text: '#f3f1ea',
        mutedText: '#aaa69b',
        accent: '#facc15',
        accentText: '#1f1a03',
        correct: '#4ade80',
        incorrect: '#f87171',
        chart: CHART_DARK,
      },
    },
    fonts: { heading: 'Playfair Display', body: 'Source Sans 3' },
  },
];

const BY_ID = new Map(THEME_PRESETS.map((preset) => [preset.id, preset]));

/** A known preset id (aliases resolved), or null. */
export const knownPresetId = (id: string | null | undefined): string | null => {
  if (!id) return null;
  const resolved = PRESET_ALIASES[id] ?? id;
  return BY_ID.has(resolved) ? resolved : null;
};

/** The preset for an id; unknown ids fall back to the default. */
export const presetFor = (id: string | null | undefined): ThemePreset =>
  BY_ID.get(knownPresetId(id) ?? DEFAULT_THEME_PRESET)!;

/** A stored mode when it is one, else null. */
export const knownThemeMode = (value: unknown): ThemeMode | null =>
  (THEME_MODES as readonly unknown[]).includes(value) ? (value as ThemeMode) : null;

/** A stored mode, or the default (light) for decks that store none. */
export const themeModeOf = (value: unknown): ThemeMode => knownThemeMode(value) ?? DEFAULT_THEME_MODE;

/** A preset in one mode, as `buildTokens` takes it. */
export const presetSource = (preset: ThemePreset, mode: ThemeMode) => ({
  name: preset.name,
  colors: preset.palettes[mode],
  fonts: preset.fonts,
});
