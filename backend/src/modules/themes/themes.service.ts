import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { assertFeature } from '../../common/plans/entitlements';
import { assertCan } from '../../common/tenancy/policy';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { PresentationModel } from '../presentations/models/presentation.model';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { BrandKitModel, MAX_BRAND_KITS, type IBrandKit } from './brandKit.model';
import { contrastFailures, contrastRatio, type ContrastColors } from './contrast';
import { FONT_CHOICES } from './fonts';
import { DEFAULT_THEME_PRESET, THEME_PRESETS, knownPresetId } from './presets';
import { buildTokens, overridesOf, type ThemeTokens } from './resolve';
import type { CreateBrandKitInput, UpdateBrandKitInput } from './themes.schema';

export const THEME_ERROR_CODES = {
  lowContrast: 'LOW_CONTRAST',
  brandKitLimit: 'BRAND_KIT_LIMIT',
  unknownPreset: 'UNKNOWN_THEME',
  unknownBrandKit: 'BRAND_KIT_NOT_FOUND',
} as const;

/** Actor with workspace context (`workspaceContext()` ran). */
type Ctx = WorkspaceRequest & { user: NonNullable<WorkspaceRequest['user']> };

export interface PresetView {
  id: string;
  name: string;
  tokens: ThemeTokens;
}

export interface BrandKitView {
  id: string;
  name: string;
  colors: IBrandKit['colors'];
  fonts: IBrandKit['fonts'];
  logo: IBrandKit['logo'];
  background: IBrandKit['background'];
  /** The kit as live surfaces would draw it. */
  tokens: ThemeTokens;
  createdAt: string;
  updatedAt: string;
}

export const presetViews = (): PresetView[] =>
  THEME_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, tokens: buildTokens(preset, preset.id, null) }));

export const fontChoices = () => [...FONT_CHOICES];

const toView = (kit: IBrandKit): BrandKitView => ({
  id: String(kit._id),
  name: kit.name,
  colors: kit.colors,
  fonts: kit.fonts,
  logo: kit.logo ?? null,
  background: kit.background ?? null,
  tokens: buildTokens(kit, DEFAULT_THEME_PRESET, String(kit._id)),
  createdAt: kit.createdAt.toISOString(),
  updatedAt: kit.updatedAt.toISOString(),
});

/** 400 LOW_CONTRAST with every failing pair when the palette is hard to read. */
export function assertReadable(colors: ContrastColors) {
  const failures = contrastFailures(colors);
  if (failures.length) {
    throw new ApiError(400, 'Some colours are too hard to read against each other', THEME_ERROR_CODES.lowContrast, {
      failures,
    });
  }
}

const notFound = () => new ApiError(404, 'Brand kit not found', THEME_ERROR_CODES.unknownBrandKit);

const findKit = async (ctx: Ctx, id: string) => {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  const kit = await BrandKitModel.findOne({ _id: id, workspaceId: ctx.workspace!._id });
  if (!kit) throw notFound();
  return kit;
};

export class BrandKitService {
  static async list(ctx: Ctx): Promise<BrandKitView[]> {
    assertCan(ctx, 'deck:read');
    const kits = await BrandKitModel.find({ workspaceId: ctx.workspace!._id }).sort({ createdAt: 1 });
    return kits.map(toView);
  }

  static async get(ctx: Ctx, id: string): Promise<BrandKitView> {
    assertCan(ctx, 'deck:read');
    return toView(await findKit(ctx, id));
  }

  static async create(ctx: Ctx, input: CreateBrandKitInput): Promise<BrandKitView> {
    assertCan(ctx, 'workspace:brand');
    assertReadable(input.colors);
    const workspaceId = ctx.workspace!._id;
    if ((await BrandKitModel.countDocuments({ workspaceId })) >= MAX_BRAND_KITS) {
      throw new ApiError(409, `A workspace keeps up to ${MAX_BRAND_KITS} brand kits`, THEME_ERROR_CODES.brandKitLimit, {
        max: MAX_BRAND_KITS,
      });
    }
    const kit = await BrandKitModel.create({
      ...input,
      logo: input.logo ?? null,
      background: input.background ?? null,
      workspaceId,
      createdBy: ctx.user.id,
    });
    void audit(ctx, 'brand_kit.create', { type: 'brand_kit', id: kit._id }, { name: kit.name });
    return toView(kit);
  }

  static async update(ctx: Ctx, id: string, input: UpdateBrandKitInput): Promise<BrandKitView> {
    assertCan(ctx, 'workspace:brand');
    const kit = await findKit(ctx, id);
    if (input.colors) assertReadable(input.colors);
    if (input.name !== undefined) kit.name = input.name;
    if (input.colors) kit.colors = input.colors;
    if (input.fonts) kit.fonts = input.fonts;
    if (input.logo !== undefined) kit.set('logo', input.logo);
    if (input.background !== undefined) kit.set('background', input.background);
    await kit.save();
    void audit(ctx, 'brand_kit.update', { type: 'brand_kit', id: kit._id }, { name: kit.name, fields: Object.keys(input) });
    return toView(kit);
  }

  /** Decks and the workspace default that used the kit go back to their preset; past sessions keep their snapshot. */
  static async remove(ctx: Ctx, id: string): Promise<{ id: string; deleted: true; decks: number }> {
    assertCan(ctx, 'workspace:brand');
    const kit = await findKit(ctx, id);
    const workspaceId = ctx.workspace!._id;
    await kit.deleteOne();
    const decks = await PresentationModel.updateMany(
      { workspaceId, 'theme.brandKitId': kit._id },
      { $set: { 'theme.brandKitId': null } }
    );
    await WorkspaceModel.updateOne(
      { _id: workspaceId, 'settings.defaultTheme.brandKitId': String(kit._id) },
      { $set: { 'settings.defaultTheme.brandKitId': null } }
    );
    void audit(ctx, 'brand_kit.delete', { type: 'brand_kit', id: kit._id }, { name: kit.name, decks: decks.modifiedCount });
    return { id: String(kit._id), deleted: true, decks: decks.modifiedCount };
  }
}

/** The fields of a deck or workspace-default theme a request may set. */
export interface ThemeChoice {
  presetId?: string;
  brandKitId?: string | null;
  overrides?: { accent?: string; accentText?: string } | null;
}

/**
 * Checks a theme a deck (or the workspace default) is about to use: a known
 * preset, a brand kit of the same workspace on a plan that has brand kits,
 * overrides that stay readable (accent text on the accent). Normalizes the
 * preset id (old aliases).
 */
export async function assertThemeChoice(
  choice: ThemeChoice,
  workspace: { _id: Types.ObjectId | string; plan?: unknown; planOverrides?: unknown } | null | undefined
): Promise<ThemeChoice> {
  const out: ThemeChoice = { ...choice };
  if (choice.presetId !== undefined) {
    const id = knownPresetId(choice.presetId);
    if (!id) throw new ApiError(400, 'Unknown theme', THEME_ERROR_CODES.unknownPreset);
    out.presetId = id;
  }
  if (choice.brandKitId) {
    if (!workspace) throw notFound();
    assertFeature(workspace as Parameters<typeof assertFeature>[0], 'brand_kits');
    const exists = await BrandKitModel.exists({ _id: choice.brandKitId, workspaceId: workspace._id });
    if (!exists) throw notFound();
  }
  if (choice.overrides) {
    const overrides = overridesOf(choice.overrides);
    if (Boolean(overrides.accent) !== Boolean(overrides.accentText)) {
      throw ApiError.badRequest('Set the accent and the text on it together');
    }
    if (overrides.accent && overrides.accentText && contrastRatio(overrides.accent, overrides.accentText) < 4.5) {
      throw new ApiError(400, 'The text on the accent colour is too hard to read', THEME_ERROR_CODES.lowContrast, {
        failures: [
          {
            foreground: 'accentText',
            background: 'accent',
            ratio: Math.round(contrastRatio(overrides.accent, overrides.accentText) * 100) / 100,
            minimum: 4.5,
          },
        ],
      });
    }
    out.overrides = Object.keys(overrides).length ? overrides : null;
  }
  return out;
}
