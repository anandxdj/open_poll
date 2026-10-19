import crypto from 'crypto';
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
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await PresentationModel.create({
        ...data,
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

export const updatePresentation = async (presentationId: string, actor: Actor, data: UpdatePresentationInput) => {
  const presentation = await authorizeDeck(presentationId, actor, 'deck:edit');
  if (presentation.status !== 'draft' && presentation.status !== 'ended') {
    throw ApiError.badRequest('Cannot edit a presentation deck while a live session is running');
  }
  if (data.slides !== undefined) {
    const workspaceId =
      presentation.workspaceId ?? (typeof actor !== 'string' && actor.workspace ? actor.workspace._id : undefined);
    if (workspaceId) await assertContentMediaInWorkspace(data.slides, String(workspaceId));
  }
  if (data.title !== undefined) presentation.title = data.title;
  if (data.slides !== undefined) presentation.slides = data.slides as IPresentationSlide[];
  if (data.pace !== undefined) presentation.pace = data.pace;
  // Settings and theme are patched field by field: omitted fields keep their value.
  for (const [path, value] of [...toPaths(data.settings ?? {}, 'settings'), ...toPaths(data.theme ?? {}, 'theme')]) {
    presentation.set(path, value);
  }
  await presentation.save();
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
