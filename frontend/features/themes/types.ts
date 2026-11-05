/** API shapes of the themes module (backend `modules/themes/resolve.ts`, `themes.service.ts`). */

/** A deck is drawn light or dark. */
export type ThemeMode = "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["light", "dark"];
/** What a deck without a stored mode is (and what the app is when its theme is unknown). */
export const DEFAULT_THEME_MODE: ThemeMode = "light";

export interface ThemeFont {
  family: string;
  source: "system" | "google" | "upload";
  url: string | null;
}

export interface ThemeColors {
  /** The stage. */
  background: string;
  /** Panels on the stage. */
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  /** Text on accent fills. */
  accentText: string;
  correct: string;
  incorrect: string;
  /** Chart and word cloud colours, in order. */
  chart: string[];
}

/** A resolved theme as sessions snapshot it. */
export interface ThemeTokens {
  presetId: string;
  /**
   * Light or dark: the deck's for a preset, the kit's own for a brand kit.
   * Absent from snapshots taken before modes (those stages were all dark).
   */
  mode?: ThemeMode;
  brandKitId: string | null;
  /** False for the built-in Graph paper look: surfaces draw their own tokens of `mode`. */
  custom: boolean;
  name: string;
  colors: ThemeColors;
  fonts: { heading: ThemeFont; body: ThemeFont };
  logo: { url: string; alt: string } | null;
  background: { imageUrl: string; overlayOpacity: number } | null;
}

export interface ThemePreset {
  id: string;
  name: string;
  /** The preset light (the default mode). */
  tokens: ThemeTokens;
  /** The preset in each mode (absent from older APIs). */
  modes?: Record<ThemeMode, ThemeTokens>;
}

export interface ThemeCatalog {
  presets: ThemePreset[];
  /** "System" first, then the Google Fonts families a kit may use. */
  fonts: string[];
}

export interface BrandKitInput {
  name: string;
  colors: ThemeColors;
  fonts: { heading: string; body: string };
  logo: { url: string; alt: string } | null;
  background: { imageUrl: string; overlayOpacity: number } | null;
}

export interface BrandKit extends BrandKitInput {
  id: string;
  tokens: ThemeTokens;
  createdAt: string;
  updatedAt: string;
}

/** What a deck stores (`presentation.theme`). */
export interface DeckThemeRef {
  presetId: string;
  /** Light or dark (absent from older APIs: light). */
  mode?: ThemeMode;
  brandKitId: string | null;
  overrides: { accent?: string; accentText?: string } | null;
}

/** A contrast check the API failed (400 LOW_CONTRAST `details.failures`). */
export interface ContrastFailure {
  foreground: keyof Omit<ThemeColors, "chart">;
  background: keyof Omit<ThemeColors, "chart">;
  ratio: number;
  minimum: number;
}

export const DEFAULT_PRESET_ID = "graph-paper";

/** A deck's look on its library card (`GET /api/library` `details.theme`). */
export interface DeckCardTheme {
  mode: ThemeMode;
  /** False for the built-in Graph paper look of `mode`. */
  custom: boolean;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
}
