import mongoose, { type QueryFilter } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { ResourceShareModel, type IResourceShare } from '../../modules/workspaces/resourceShare.model';
import { WorkspaceGroupModel } from '../../modules/workspaces/workspaceGroup.model';
import { ROLE_RANK, roleAllows, shareAllows, type Action, type ShareRole, type WorkspaceRole } from './roles';

type IdLike = string | { toString(): string };

/** A ResourceShare that applies to the caller (directly or through a group) on the resource being checked. */
export interface ShareGrant {
  resourceType: 'presentation' | 'folder';
  resourceId: IdLike;
  role: ShareRole;
}

/**
 * Who is acting and where. An Express request after authenticate() and
 * workspaceContext() satisfies this shape, so `assertCan(req, ...)` works.
 */
export interface PolicyContext {
  user?: { id: string } | null;
  workspace?: { _id: IdLike } | null;
  membership?: { role: WorkspaceRole; status: string; workspaceId?: IdLike } | null;
  /**
   * Share grants of the user on the resource, when the caller loaded them
   * (`withShareGrants`, or the `*WithShares` helpers that do it on demand).
   * Without them only the workspace role counts.
   */
  shareGrants?: readonly ShareGrant[] | null;
}

/**
 * The fields of a deck, poll, folder or session the policy looks at. `_id` and
 * `folderId` are only used to match share grants (decks and folders).
 */
export interface PolicyResource {
  workspaceId?: IdLike | null;
  creatorId?: IdLike | null;
  _id?: IdLike | null;
  folderId?: IdLike | null;
  /** What `_id` is: a deck (default) or a folder. Only matters for matching share grants. */
  kind?: 'presentation' | 'folder';
}

export type PolicyDenial = 'unauthenticated' | 'not_member' | 'other_workspace' | 'role' | 'not_creator';
export type PolicyDecision = { allowed: true; via?: 'role' | 'share' | 'creator' } | { allowed: false; reason: PolicyDenial };

const sameId = (a: IdLike | null | undefined, b: IdLike | null | undefined) =>
  a != null && b != null && String(a) === String(b);

/**
 * The strongest share role among `grants` that applies to `resource`: a grant
 * on the deck itself, or on the folder it sits in.
 */
export function effectiveShareRole(
  grants: readonly ShareGrant[] | null | undefined,
  resource: PolicyResource | null | undefined,
): ShareRole | null {
  if (!grants?.length || !resource) return null;
  let best: ShareRole | null = null;
  for (const grant of grants) {
    const isFolder = resource.kind === 'folder';
    const applies = isFolder
      ? grant.resourceType === 'folder' && sameId(grant.resourceId, resource._id)
      : (grant.resourceType === 'presentation' && sameId(grant.resourceId, resource._id)) ||
        (grant.resourceType === 'folder' && sameId(grant.resourceId, resource.folderId));
    if (applies && (best === null || ROLE_RANK[grant.role] > ROLE_RANK[best])) best = grant.role;
  }
  return best;
}

/**
 * Decides whether the context may perform `action` (on `resource`, if given).
 *
 * - A resource without `workspaceId` predates workspaces (until migration 020
 *   backfills it): only its creator may act on it, whatever the action.
 * - Otherwise the caller needs an active membership of the current workspace
 *   and the resource must belong to that workspace (shares never cross
 *   workspaces).
 * - The member's role allows the action (roles.ts ACTION_MATRIX), or
 * - a share grant on the resource (or its folder) allows it: shares only add
 *   SHAREABLE_ACTIONS, never more than the same role has workspace-wide
 *   (roles.ts SHARE_PERMISSIONS). They raise access, never lower it.
 */
export function evaluate(ctx: PolicyContext, action: Action, resource?: PolicyResource | null): PolicyDecision {
  const userId = ctx.user?.id;
  if (!userId) return { allowed: false, reason: 'unauthenticated' };

  if (resource && resource.workspaceId == null) {
    return sameId(resource.creatorId, userId) ? { allowed: true, via: 'creator' } : { allowed: false, reason: 'not_creator' };
  }

  const { workspace, membership } = ctx;
  if (
    !workspace ||
    !membership ||
    membership.status !== 'active' ||
    (membership.workspaceId != null && !sameId(membership.workspaceId, workspace._id))
  ) {
    return { allowed: false, reason: 'not_member' };
  }
  if (resource && !sameId(resource.workspaceId, workspace._id)) {
    return { allowed: false, reason: 'other_workspace' };
  }
  if (roleAllows(membership.role, action)) return { allowed: true, via: 'role' };

  const shareRole = effectiveShareRole(ctx.shareGrants, resource);
  if (shareRole && shareAllows(shareRole, action)) return { allowed: true, via: 'share' };
  return { allowed: false, reason: 'role' };
}

export const can = (ctx: PolicyContext, action: Action, resource?: PolicyResource | null): boolean =>
  evaluate(ctx, action, resource).allowed;

const forbidden = (action: Action) =>
  new ApiError(403, 'You do not have permission to perform this action', 'FORBIDDEN', { action });

/**
 * Throws 401 without a user, 403 FORBIDDEN when the policy denies the action.
 * The denial reason is not sent: "belongs to another workspace" would confirm
 * that the resource exists.
 */
export function assertCan(ctx: PolicyContext, action: Action, resource?: PolicyResource | null): void {
  const decision = evaluate(ctx, action, resource);
  if (decision.allowed) return;
  if (decision.reason === 'unauthenticated') throw ApiError.unauthorized('Not authenticated');
  throw forbidden(action);
}

// ---------- Share grants (ResourceShare) ----------

const toObjectId = (value: IdLike | null | undefined): mongoose.Types.ObjectId | null =>
  value != null && mongoose.isValidObjectId(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null;

/**
 * Share grants of `userId` on `resource` (the deck and the folder it sits in),
 * directly or through a WorkspaceGroup of the resource's workspace.
 */
export async function loadShareGrants(userId: string, resource: PolicyResource): Promise<ShareGrant[]> {
  const workspaceId = toObjectId(resource.workspaceId);
  const user = toObjectId(userId);
  const self = toObjectId(resource._id);
  const folder = toObjectId(resource.folderId);
  const resourceClauses: QueryFilter<IResourceShare>[] = [];
  if (resource.kind === 'folder') {
    if (self) resourceClauses.push({ resourceType: 'folder', resourceId: self });
  } else {
    if (self) resourceClauses.push({ resourceType: 'presentation', resourceId: self });
    if (folder) resourceClauses.push({ resourceType: 'folder', resourceId: folder });
  }
  if (!workspaceId || !user || resourceClauses.length === 0) return [];

  const groupIds = await WorkspaceGroupModel.find({ workspaceId, memberIds: user }).distinct('_id');
  const principalClauses: QueryFilter<IResourceShare>[] = [{ principalType: 'user', principalId: user }];
  if (groupIds.length) principalClauses.push({ principalType: 'group', principalId: { $in: groupIds } });

  const shares = await ResourceShareModel.find({
    workspaceId,
    $and: [{ $or: resourceClauses }, { $or: principalClauses }],
  })
    .select('resourceType resourceId role')
    .lean();
  return shares.map((share) => ({ resourceType: share.resourceType, resourceId: share.resourceId, role: share.role }));
}

/** The context with the user's share grants on `resource` attached. */
export async function withShareGrants(ctx: PolicyContext, resource: PolicyResource): Promise<PolicyContext> {
  const shareGrants = ctx.user?.id ? await loadShareGrants(ctx.user.id, resource) : [];
  return { user: ctx.user, workspace: ctx.workspace, membership: ctx.membership, shareGrants };
}

/**
 * evaluate(), loading share grants only when the workspace role alone is not
 * enough (one extra query in that case, none otherwise).
 */
export async function evaluateWithShares(
  ctx: PolicyContext,
  action: Action,
  resource: PolicyResource,
): Promise<PolicyDecision> {
  const decision = evaluate(ctx, action, resource);
  if (decision.allowed || decision.reason !== 'role' || ctx.shareGrants) return decision;
  return evaluate(await withShareGrants(ctx, resource), action, resource);
}

export const canWithShares = async (ctx: PolicyContext, action: Action, resource: PolicyResource): Promise<boolean> =>
  (await evaluateWithShares(ctx, action, resource)).allowed;

/** assertCan() for a deck or folder, counting the caller's share grants on it. */
export async function assertCanWithShares(ctx: PolicyContext, action: Action, resource: PolicyResource): Promise<void> {
  const decision = await evaluateWithShares(ctx, action, resource);
  if (decision.allowed) return;
  if (decision.reason === 'unauthenticated') throw ApiError.unauthorized('Not authenticated');
  throw forbidden(action);
}
