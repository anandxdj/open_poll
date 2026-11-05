import mongoose from 'mongoose';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { authorizeDeck } from '../presentations/access';
import { createPresentation, copyDeckForWorkspace, deletePresentation } from '../presentations/crud.service';
import { PresentationModel, type IPresentation } from '../presentations/models/presentation.model';
import { createPresentationSchema, type CreatePresentationInput } from '../presentations/presentations.schema';
import { getSlideType, type Slide } from '../presentations/slides';
import type { ThemeMode } from '../themes/presets';
import { findSeedTemplate, SEED_TEMPLATES, type SeedTemplate } from './seeds';

type IdLike = string | { toString(): string };

/** The caller after authenticate() + workspaceContext(). */
export type TemplateActor = PolicyContext & { user: { id: string }; workspace: { _id: IdLike } };

/** Workspace templates listed (newest first). */
export const MAX_WORKSPACE_TEMPLATES = 100;
/** Slide labels shown on a template card. */
const OUTLINE_LENGTH = 6;

/** One template card: a starter deck (code) or a workspace template (a deck with `isTemplate`). */
export interface TemplateSummary {
  id: string;
  source: 'starter' | 'workspace';
  title: string;
  /** Starter templates only (empty for workspace templates). */
  description: string;
  /** Starter templates only. */
  category: string | null;
  slideCount: number;
  /** Distinct slide types in deck order, at most six (card icons). */
  slideTypes: string[];
  /** The first slides' labels (question, heading, …). */
  outline: string[];
  pace: 'presenter' | 'audience';
  /** Workspace templates only: who saved it. */
  createdBy: { id: string; name: string } | null;
  /** Workspace templates only. */
  updatedAt: string | null;
}

export interface TemplateList {
  starter: TemplateSummary[];
  workspace: TemplateSummary[];
}

const templateNotFound = () => new ApiError(404, 'Template not found', 'TEMPLATE_NOT_FOUND');

const labelOf = (slide: Record<string, unknown>): string => {
  const def = getSlideType(slide.type);
  try {
    return def ? def.label(slide as unknown as Slide) : String(slide.type ?? '');
  } catch {
    return def?.name ?? '';
  }
};

const summarizeSlides = (slides: Record<string, unknown>[]) => ({
  slideCount: slides.length,
  slideTypes: [...new Set(slides.map((slide) => String(slide.type ?? '')).filter(Boolean))].slice(0, 6),
  outline: slides.slice(0, OUTLINE_LENGTH).map(labelOf).filter(Boolean),
});

/** Starter decks parsed once (defaults filled in); a seed that does not parse throws, which the seed test catches. */
let parsedSeeds: Map<string, CreatePresentationInput> | null = null;
const parsedSeed = (seed: SeedTemplate): CreatePresentationInput => {
  parsedSeeds ??= new Map();
  let parsed = parsedSeeds.get(seed.id);
  if (!parsed) {
    parsed = createPresentationSchema.parse(seed.deck);
    parsedSeeds.set(seed.id, parsed);
  }
  return parsed;
};

const toStarterSummary = (seed: SeedTemplate): TemplateSummary => {
  const deck = parsedSeed(seed);
  return {
    id: seed.id,
    source: 'starter',
    title: seed.title,
    description: seed.description,
    category: seed.category,
    ...summarizeSlides(deck.slides as unknown as Record<string, unknown>[]),
    pace: deck.pace ?? 'presenter',
    createdBy: null,
    updatedAt: null,
  };
};

const toWorkspaceSummary = (template: IPresentation, names: Map<string, string>): TemplateSummary => ({
  id: String(template._id),
  source: 'workspace',
  title: template.title,
  description: '',
  category: null,
  ...summarizeSlides(template.slides as unknown as Record<string, unknown>[]),
  pace: template.pace === 'audience' ? 'audience' : 'presenter',
  createdBy: template.creatorId ? { id: template.creatorId, name: names.get(template.creatorId) ?? 'A former member' } : null,
  updatedAt: new Date(template.updatedAt).toISOString(),
});

/** A workspace template of the caller's workspace, after checking `action` on it; 404 for anything else. */
async function authorizeTemplate(ctx: TemplateActor, id: string, action: 'deck:read' | 'deck:delete') {
  if (!mongoose.isValidObjectId(id)) throw templateNotFound();
  const template = await authorizeDeck(id, ctx, action).catch((error: unknown) => {
    if (error instanceof ApiError && error.statusCode === 404) throw templateNotFound();
    throw error;
  });
  if (!template.isTemplate) throw templateNotFound();
  return template;
}

/**
 * Templates (W3-B2): the starter decks in `seeds.ts`, plus workspace
 * templates saved from a deck ("Save as template": a copy with
 * `isTemplate: true`, hidden from the library and the deck list). "Use
 * template" makes a new draft deck from either.
 *
 * - list: `deck:read` (any member);
 * - save as template: `deck:read` on the deck (shares count) and `deck:create`;
 * - use: `deck:create`, plus `deck:read` on a workspace template;
 * - delete a workspace template: `deck:delete` (the workspace role).
 */
export class TemplatesService {
  static async list(ctx: TemplateActor): Promise<TemplateList> {
    assertCan(ctx, 'deck:read');
    const templates = await PresentationModel.find({
      workspaceId: new mongoose.Types.ObjectId(String(ctx.workspace._id)),
      isTemplate: true,
      deletedAt: null,
    })
      .sort({ updatedAt: -1 })
      .limit(MAX_WORKSPACE_TEMPLATES);
    const creatorIds = [...new Set(templates.map((template) => template.creatorId).filter((id) => mongoose.isValidObjectId(id)))];
    const users = creatorIds.length ? await UserModel.find({ _id: { $in: creatorIds } }).select('name').lean() : [];
    const names = new Map(users.map((user) => [String(user._id), user.name ?? '']));
    return {
      starter: SEED_TEMPLATES.map(toStarterSummary),
      workspace: templates.map((template) => toWorkspaceSummary(template, names)),
    };
  }

  /** Copies a deck of the workspace into a new workspace template. */
  static async saveAsTemplate(ctx: TemplateActor, presentationId: string, title?: string) {
    assertCan(ctx, 'deck:create');
    const source = await authorizeDeck(presentationId, ctx, 'deck:read');
    if (source.isTemplate) throw new ApiError(409, 'This is already a template', 'ALREADY_A_TEMPLATE');
    return copyDeckForWorkspace(source, ctx, {
      title: title ?? source.title,
      isTemplate: true,
      templateSourceId: source._id,
    });
  }

  /**
   * A new draft deck from a template: a starter (by slug) or a workspace
   * template (by id). The deck is an ordinary deck of the caller's workspace;
   * a workspace template is linked as its `templateSourceId`. `themeMode` is
   * the creator's light or dark; without it a starter is light and a workspace
   * template keeps its own.
   */
  static async use(ctx: TemplateActor, templateId: string, title?: string, themeMode?: ThemeMode) {
    assertCan(ctx, 'deck:create');
    const seed = findSeedTemplate(templateId);
    if (seed) {
      const deck = parsedSeed(seed);
      return createPresentation({ ...deck, title: title ?? deck.title, ...(themeMode ? { theme: { mode: themeMode } } : {}) }, ctx);
    }
    const template = await authorizeTemplate(ctx, templateId, 'deck:read');
    return copyDeckForWorkspace(template, ctx, {
      title: title ?? template.title,
      isTemplate: false,
      templateSourceId: template._id,
      ...(themeMode ? { mode: themeMode } : {}),
    });
  }

  /** Deletes a workspace template (decks made from it are not touched). */
  static async remove(ctx: TemplateActor, templateId: string) {
    const template = await authorizeTemplate(ctx, templateId, 'deck:delete');
    await deletePresentation(String(template._id), ctx);
    return { id: String(template._id), title: template.title };
  }
}
