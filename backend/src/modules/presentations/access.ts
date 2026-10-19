import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { assertCanWithShares, canWithShares, type PolicyContext, type PolicyResource } from '../../common/tenancy/policy';
import type { Action } from '../../common/tenancy/roles';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { PresentationModel, type IPresentation } from './models/presentation.model';

/**
 * Who performs a deck operation:
 * - a policy context — an HTTP request after `authenticate()` + `workspaceContext()`;
 * - a bare user id — sockets, scripts and tests. It is resolved against the
 *   deck's own workspace (the user's membership there), since there is no
 *   `X-Workspace-Id` to pick one.
 */
export type Actor = string | PolicyContext;

export const actorUserId = (actor: Actor): string | null =>
  typeof actor === 'string' ? actor : (actor.user?.id ?? null);

/** The policy context for `actor` acting on `resource`. */
export const actorContext = async (actor: Actor, resource?: PolicyResource | null): Promise<PolicyContext> => {
  if (typeof actor !== 'string') return actor;
  const user = { id: actor };
  const workspaceId = resource?.workspaceId;
  if (workspaceId == null || !mongoose.isValidObjectId(actor)) return { user };
  const membership = await WorkspaceMemberModel.findOne({
    workspaceId: String(workspaceId),
    userId: actor,
    status: 'active',
  }).lean();
  return membership ? { user, workspace: { _id: workspaceId }, membership } : { user };
};

/** A deck that is not in the trash, or 404. */
export const getPresentationById = async (presentationId: string): Promise<IPresentation> => {
  const presentation = mongoose.isValidObjectId(presentationId)
    ? await PresentationModel.findById(presentationId)
    : null;
  if (!presentation || presentation.deletedAt) throw ApiError.notFound('Presentation deck not found');
  return presentation;
};

/**
 * Loads the deck and checks `action` on it (401/403 from the policy, 404 when
 * missing). Share grants on the deck or its folder count (W3-B1).
 */
export const authorizeDeck = async (presentationId: string, actor: Actor, action: Action): Promise<IPresentation> => {
  const presentation = await getPresentationById(presentationId);
  await assertCanWithShares(await actorContext(actor, presentation), action, presentation);
  return presentation;
};

/** Non-throwing check for the socket layer, which just needs a yes/no. */
export const canActOnDeck = async (presentationId: string, userId: string, action: Action): Promise<boolean> => {
  try {
    const presentation = await getPresentationById(presentationId);
    return await canWithShares(await actorContext(userId, presentation), action, presentation);
  } catch {
    return false;
  }
};
