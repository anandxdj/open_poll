import crypto from 'crypto';
import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { copyTitle } from '../../common/utils/copyTitle';
import { redisClient } from '../../common/config/redis';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import {
  PresentationModel,
  type IPresentation,
  type IPresentationSlide,
  type IPresentationSlideOption,
} from './models/presentation.model';
import { PresentationParticipantModel } from './models/participant.model';
import { PresentationAnswerModel } from './models/answer.model';
import { PresentationSessionModel } from './models/session.model';
import { ResourceShareModel } from '../workspaces/resourceShare.model';
import { authorizeDeck, type Actor } from './access';
import { allSessionKeys, k } from './live/keys';
import { assertContentMediaInWorkspace } from './slides/types/content/media';
import { assertThemeChoice, type ThemeChoice } from '../themes/themes.service';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { announceScreensRevoked } from '../embeds/screenTokens.service';
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
  return createWithJoinCode({
    ...data,
    ...(theme ? { theme: theme as Record<string, unknown> } : {}),
    creatorId,
    ...(workspaceId ? { workspaceId } : {}),
  });
};

/** Saves a new deck under a fresh join code, retrying the rare collision. */
const createWithJoinCode = async (deck: Record<string, unknown>) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await PresentationModel.create({ ...deck, joinCode: generateJoinCode() });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
    }
  }
  throw ApiError.internal('Could not allocate a unique join code, please retry');
};

/** createPresentationSchema's title limit. */
const MAX_DECK_TITLE = 120;

type StoredSlide = IPresentationSlide & { options?: Array<IPresentationSlideOption & { _id?: unknown }> };

/** A stored slide as a new one: no `_id` (on the slide or its options), everything else as is. */
const copySlide = ({ _id, ...slide }: StoredSlide) => ({
  ...slide,
  options: (slide.options ?? []).map(({ text, isCorrect }) => ({ text, isCorrect })),
});

/**
 * Copies a deck into the caller's current workspace as a new draft with its
 * own join code: title "Copy of …", every slide (new slide ids; settings,
 * speaker notes and media references kept), pace, deck settings, theme and
 * folder. Sessions, participants and answers stay with the original.
 *
 * Needs `deck:read` on the source (share grants count) and `deck:create` in
 * the current workspace. The policy keeps the source in that workspace, except
 * a deck from before workspaces, which only its creator reaches: its media is
 * checked against the new workspace and it keeps no brand kit or folder.
 */
export const duplicatePresentation = async (presentationId: string, ctx: PolicyContext) => {
  assertCan(ctx, 'deck:create');
  const source = (await authorizeDeck(presentationId, ctx, 'deck:read')).toObject() as IPresentation;
  // assertCan('deck:create') only passes with an active membership of a workspace.
  const workspaceId = String(ctx.workspace!._id);
  const sameWorkspace = source.workspaceId != null && String(source.workspaceId) === workspaceId;

  const slides = (source.slides as StoredSlide[]).map(copySlide);
  if (!sameWorkspace) await assertContentMediaInWorkspace(slides, workspaceId);
  const theme = source.theme ?? null;

  return createWithJoinCode({
    title: copyTitle(source.title, MAX_DECK_TITLE),
    slides,
    pace: source.pace,
    settings: source.settings,
    ...(theme
      ? { theme: { presetId: theme.presetId, brandKitId: sameWorkspace ? theme.brandKitId : null, overrides: theme.overrides } }
      : {}),
    folderId: sameWorkspace ? source.folderId : null,
    creatorId: ctx.user!.id,
    workspaceId,
  });
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
/**
 * Whether a patch only switches embedding (`settings.embed`): the one deck
 * setting a presenter may change while a session is live (W4-D), e.g. to put
 * the stage on a second screen mid-session. It changes nothing the running
 * session reads (that runs from its snapshot).
 */
export const isEmbedOnlyPatch = (data: UpdatePresentationInput): boolean => {
  const fields = Object.entries(data).filter(([, value]) => value !== undefined);
  if (fields.length !== 1 || fields[0]![0] !== 'settings') return false;
  const settings = Object.entries(data.settings ?? {}).filter(([, value]) => value !== undefined);
  return settings.length === 1 && settings[0]![0] === 'embed';
};

/** Turning embedding off sends the deck's connected screens away at once, on every instance (W4-D). */
const afterUpdate = async (presentationId: string, data: UpdatePresentationInput) => {
  if (data.settings?.embed?.allowed === false) {
    await announceScreensRevoked({ presentationId, reason: 'embed_disabled' });
  }
};

export const updatePresentation = async (
  presentationId: string,
  actor: Actor,
  data: UpdatePresentationInput,
  options: { expectedVersion?: number } = {},
) => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:edit');
  const live = presentation.status !== 'draft' && presentation.status !== 'ended';
  if (live && !isEmbedOnlyPatch(data)) {
    throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
  }
  if (options.expectedVersion !== undefined && presentation.get('__v') !== options.expectedVersion) throw deckChanged();
  if (live) {
    // One atomic $set: the live session's deck mirror (status, current slide) is written by
    // host commands at the same time, and a whole-document save could race them.
    const $set = Object.fromEntries(toPaths(data.settings ?? {}, 'settings'));
    const updated = await PresentationModel.findOneAndUpdate({ _id: presentation._id }, { $set }, { returnDocument: 'after' });
    if (!updated) throw ApiError.notFound('Presentation deck not found');
    await afterUpdate(presentationId, data);
    return updated;
  }
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
  await afterUpdate(presentationId, data);
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
