/** API shapes of the themes module (backend `modules/themes/resolve.ts`, `themes.service.ts`). */

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
  brandKitId: string | null;
  /** False for the built-in look: surfaces keep their defaults. */
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
  tokens: ThemeTokens;
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
