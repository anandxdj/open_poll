import type { Types } from 'mongoose';
import { getEntitlements } from '../../common/plans/entitlements';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { BrandKitModel } from './brandKit.model';
import { themeFont, type FontChoice } from './fonts';
import { DEFAULT_THEME_PRESET, presetFor } from './presets';

/**
 * Resolves a deck's theme reference into the tokens every live surface renders
 * with (`--deck-*` CSS variables on the frontend): preset, then the brand kit
 * the deck picked (when the workspace's plan still has brand kits), then the
 * deck's own overrides. Sessions snapshot the result when they open, so a
 * later theme edit never restyles a past session's report.
 */

export { DEFAULT_THEME_PRESET } from './presets';

export interface ThemeFont {
  family: string;
  /** `system` fonts need no download; `google` and `upload` load from `url`. */
  source: 'system' | 'google' | 'upload';
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
  /** Series colours for result charts and word clouds, in order. */
  chart: string[];
}

export interface ThemeTokens {
  presetId: string;
  /** The brand kit applied, if any. */
  brandKitId: string | null;
  /** False for the default preset with no kit or overrides: surfaces keep their built-in look. */
  custom: boolean;
  /** The preset's or the brand kit's name. */
  name: string;
  colors: ThemeColors;
  fonts: { heading: ThemeFont; body: ThemeFont };
  logo: { url: string; alt: string } | null;
  background: { imageUrl: string; overlayOpacity: number } | null;
}

/** What a deck may override on top of its preset or brand kit. */
export interface ThemeOverrides {
  accent?: string;
  accentText?: string;
}

export interface ThemeRef {
  presetId?: string | null;
  brandKitId?: unknown;
  overrides?: unknown;
}

export interface ResolveOptions {
  /** The deck's workspace: a brand kit only applies inside its own workspace. */
  workspaceId?: Types.ObjectId | string | null;
  /** The workspace's plan includes brand kits. */
  brandKits?: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** The override keys that hold a valid colour; anything else stored is ignored. */
export const overridesOf = (value: unknown): ThemeOverrides => {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const out: ThemeOverrides = {};
  for (const key of ['accent', 'accentText'] as const) {
    if (typeof raw[key] === 'string' && HEX.test(raw[key] as string)) out[key] = raw[key] as string;
  }
  return out;
};

/** A palette, fonts and pictures to build tokens from: a preset or a brand kit. */
export interface ThemeSource {
  name: string;
  colors: ThemeColors;
  fonts: { heading: FontChoice; body: FontChoice };
  logo?: ThemeTokens['logo'];
  background?: ThemeTokens['background'];
}

const COLOR_KEYS = ['background', 'surface', 'text', 'mutedText', 'accent', 'accentText', 'correct', 'incorrect'] as const;

/** Tokens from a preset or brand kit plus overrides (no lookups). Copies every value, so the result is plain JSON. */
export const buildTokens = (
  source: ThemeSource,
  presetId: string,
  brandKitId: string | null,
  overrides: ThemeOverrides = {}
): ThemeTokens => {
  const colors = Object.fromEntries(COLOR_KEYS.map((key) => [key, String(source.colors[key])])) as Omit<ThemeColors, 'chart'>;
  return {
    presetId,
    brandKitId,
    custom: presetId !== DEFAULT_THEME_PRESET || brandKitId !== null || Object.keys(overrides).length > 0,
    name: source.name,
    colors: { ...colors, chart: Array.from(source.colors.chart ?? [], String), ...overrides },
    fonts: { heading: themeFont(source.fonts.heading), body: themeFont(source.fonts.body) },
    logo: source.logo ? { url: source.logo.url, alt: source.logo.alt ?? '' } : null,
    background: source.background
      ? { imageUrl: source.background.imageUrl, overlayOpacity: source.background.overlayOpacity }
      : null,
  };
};

/** Tokens for a theme reference; unknown presets fall back to the default preset. */
export const resolveTheme = async (ref: ThemeRef | null | undefined, options: ResolveOptions = {}): Promise<ThemeTokens> => {
  const preset = presetFor(ref?.presetId);
  const overrides = overridesOf(ref?.overrides);
  const kitId = ref?.brandKitId ? String(ref.brandKitId) : null;
  if (kitId && options.brandKits && options.workspaceId && /^[a-f0-9]{24}$/i.test(kitId)) {
    const kit = await BrandKitModel.findOne({ _id: kitId, workspaceId: options.workspaceId }).lean();
    if (kit) return buildTokens(kit, preset.id, String(kit._id), overrides);
  }
  return buildTokens(preset, preset.id, null, overrides);
};

/** A deck's theme as its workspace's plan allows it (session open, previews). */
export const resolveDeckTheme = async (deck: { theme?: ThemeRef | null; workspaceId?: Types.ObjectId | null }) => {
  const workspace = deck.workspaceId
    ? await WorkspaceModel.findById(deck.workspaceId).select('plan planOverrides billing planSource').lean()
    : null;
  return resolveTheme(deck.theme, {
    workspaceId: deck.workspaceId ?? null,
    brandKits: workspace ? getEntitlements(workspace).features.brand_kits : false,
  });
};
