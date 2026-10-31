import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { redisClient } from '../../common/config/redis';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { PresentationModel, type IPresentationSlide } from './models/presentation.model';
import { PresentationParticipantModel } from './models/participant.model';
import { PresentationAnswerModel } from './models/answer.model';
import { PresentationSessionModel } from './models/session.model';
import { ResourceShareModel } from '../workspaces/resourceShare.model';
import { authorizeDeck, type Actor } from './access';
import { allSessionKeys, k } from './live/keys';
import { assertContentMediaInWorkspace } from './slides/types/content/media';
import { assertThemeChoice, type ThemeChoice } from '../themes/themes.service';
import { WorkspaceModel } from '../workspaces/workspace.model';
import type { CreatePresentationInput, UpdatePresentationInput } from './presentations.schema';

const generateJoinCode = () => crypto.randomInt(100000, 1000000).toString();

/** Nested plain objects → `a.b.c` paths (arrays and scalars are leaves), for partial updates. */
const toPaths = (value: Record<string, unknown>, prefix: string): [string, unknown][] =>
  Object.entries(value).flatMap(([key, child]) =>
    child !== null && typeof child === 'object' && !Array.isArray(child)
      ? toPaths(child as Record<string, unknown>, `${prefix}.${key}`)
      : [[`${prefix}.${key}`, child] as [string, unknown]]
  );

/**
 * Creates a deck in the actor's current workspace. A bare user id (scripts,
 * tests) creates a deck without a workspace, which only its creator can reach.
 */
export const createPresentation = async (data: CreatePresentationInput, actor: Actor) => {
  let creatorId = typeof actor === 'string' ? actor : '';
  let workspaceId: string | undefined;
  if (typeof actor !== 'string') {
    assertCan(actor, 'deck:create');
    creatorId = actor.user!.id;
    workspaceId = actor.workspace ? String(actor.workspace._id) : undefined;
  }
  // Uploaded media must belong to the deck's workspace (the request schema cannot query).
  if (workspaceId && data.slides) await assertContentMediaInWorkspace(data.slides, workspaceId);
  // A new deck starts on the workspace's default theme unless the request picks one.
  const workspace = typeof actor === 'string' ? null : (actor.workspace ?? null);
  const defaultTheme = (workspace as { settings?: { defaultTheme?: ThemeChoice | null } } | null)?.settings?.defaultTheme;
  const themeChoice: ThemeChoice | undefined = data.theme ?? (defaultTheme ? { ...defaultTheme } : undefined);
  const theme = themeChoice ? await assertThemeChoice(themeChoice, workspace as Parameters<typeof assertThemeChoice>[1]) : undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await PresentationModel.create({
        ...data,
        ...(theme ? { theme: theme as Record<string, unknown> } : {}),
        creatorId,
        ...(workspaceId ? { workspaceId } : {}),
        joinCode: generateJoinCode(),
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw ApiError.internal('Could not allocate a unique join code, please retry');
};

/**
 * Decks of the actor's current workspace, most recently updated first. In
 * their personal workspace a user also sees their own decks that predate
 * workspaces (no `workspaceId` until migration 020 backfills it).
 */
export interface ListContext extends PolicyContext {
  workspace?: { _id: { toString(): string }; type?: string; ownerId?: unknown } | null;
}

export const listPresentations = async (ctx: ListContext) => {
  assertCan(ctx, 'deck:read');
  const userId = ctx.user!.id;
  const workspace = ctx.workspace!;
  const scopes: Record<string, unknown>[] = [{ workspaceId: workspace._id }];
  if (workspace.type === 'personal' && String(workspace.ownerId) === userId) {
    scopes.push({ workspaceId: null, creatorId: userId });
  }
  return PresentationModel.find({ $or: scopes, deletedAt: null }).sort({ updatedAt: -1 });
};

const deckChanged = () =>
  new ApiError(409, 'The deck changed since it was read; read it again and retry', 'DECK_CHANGED');

/**
 * `expectedVersion` (the `__v` the caller read) turns a read-modify-write of
 * the slides into a compare-and-set: another save in between is a 409
 * instead of a silent lost update. Saves are versioned (optimisticConcurrency).
 */
export const updatePresentation = async (
  presentationId: string,
  actor: Actor,
  data: UpdatePresentationInput,
  options: { expectedVersion?: number } = {},
) => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:edit');
  if (presentation.status !== 'draft' && presentation.status !== 'ended') {
    throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
  }
  if (options.expectedVersion !== undefined && presentation.get('__v') !== options.expectedVersion) throw deckChanged();
  if (data.slides !== undefined) {
    const workspaceId =
      presentation.workspaceId ?? (typeof actor !== 'string' && actor.workspace ? actor.workspace._id : undefined);
    if (workspaceId) await assertContentMediaInWorkspace(data.slides, String(workspaceId));
  }
  if (data.title !== undefined) presentation.title = data.title;
  if (data.slides !== undefined) presentation.slides = data.slides as IPresentationSlide[];
  if (data.pace !== undefined) presentation.pace = data.pace;
  // Settings are patched field by field: omitted fields keep their value.
  for (const [path, value] of toPaths(data.settings ?? {}, 'settings')) {
    presentation.set(path, value);
  }
  // Theme fields are replaced whole (overrides is one object), after checking them against the deck's workspace.
  if (data.theme) {
    const workspace = presentation.workspaceId ? await WorkspaceModel.findById(presentation.workspaceId).lean() : null;
    const theme = await assertThemeChoice(data.theme, workspace);
    for (const key of ['presetId', 'brandKitId', 'overrides'] as const) {
      if (theme[key] !== undefined) presentation.set(`theme.${key}`, theme[key]);
    }
  }
  try {
    await presentation.save();
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) throw deckChanged();
    throw error;
  }
  return presentation;
};

/** Deletes the deck with every session, participant, answer and Redis key it has. */
export const deletePresentation = async (presentationId: string, actor: Actor) => {
  await authorizeDeck(presentationId, actor, 'deck:delete');
  const sessions = await PresentationSessionModel.find({ presentationId }).select('_id deckSnapshot').lean();
  const keys = [
    k.active(presentationId),
    ...sessions.flatMap((session) =>
      allSessionKeys(
        String(session._id),
        (session.deckSnapshot ?? []).map((slide) => String(slide._id))
      )
    ),
  ];
  await Promise.all([
    PresentationModel.findByIdAndDelete(presentationId),
    PresentationSessionModel.deleteMany({ presentationId }),
    PresentationParticipantModel.deleteMany({ presentationId }),
    PresentationAnswerModel.deleteMany({ presentationId }),
    ResourceShareModel.deleteMany({ resourceType: 'presentation', resourceId: presentationId }),
    redisClient.del(keys).catch(() => {}),
  ]);
};
