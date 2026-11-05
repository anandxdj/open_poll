import type { FontChoice } from './fonts';
import type { ThemeColors } from './resolve';

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
  fonts: { heading: FontChoice; body: FontChoice };
}

/** The Graph paper look the live surfaces draw without a theme. */
export const DEFAULT_THEME_PRESET = 'graph-paper';

/** Ids decks stored before the presets were renamed. */
const PRESET_ALIASES: Record<string, string> = { amber: DEFAULT_THEME_PRESET };

/** Word cloud and chart hues every dark stage can use (the app's categorical order). */
const CHART = [
  '#fb923c', '#60a5fa', '#4ade80', '#a78bfa', '#f472b6', '#22d3ee',
  '#fbbf24', '#2dd4bf', '#e879f9', '#a3e635', '#fdba74', '#93c5fd',
];

/**
 * Built-in themes: each a dark stage (projectors wash out light ones) with its
 * own accent. Every palette passes `contrastFailures` (tested).
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: DEFAULT_THEME_PRESET,
    name: 'Graph paper',
    colors: {
      background: '#141413',
      surface: '#1f1f1d',
      text: '#f2f1ec',
      mutedText: '#a8a49c',
      accent: '#f97316',
      accentText: '#1a0d04',
      correct: '#22c55e',
      incorrect: '#f87171',
      chart: CHART,
    },
    fonts: { heading: 'System', body: 'System' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    colors: {
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
    fonts: { heading: 'DM Sans', body: 'DM Sans' },
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: {
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
    fonts: { heading: 'Nunito', body: 'Nunito' },
  },
  {
    id: 'grape',
    name: 'Grape',
    colors: {
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
    fonts: { heading: 'Poppins', body: 'Poppins' },
  },
  {
    id: 'mono',
    name: 'Mono',
    colors: {
      background: '#111111',
      surface: '#1c1c1c',
      text: '#f5f5f5',
      mutedText: '#a3a3a3',
      accent: '#f5f5f5',
      accentText: '#111111',
      correct: '#4ade80',
      incorrect: '#f87171',
      chart: CHART,
    },
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
  },
  {
    id: 'classic',
    name: 'Classic',
    colors: {
      background: '#14161c',
      surface: '#1d2029',
      text: '#f3f1ea',
      mutedText: '#aaa69b',
      accent: '#facc15',
      accentText: '#1f1a03',
      correct: '#4ade80',
      incorrect: '#f87171',
      chart: CHART,
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
