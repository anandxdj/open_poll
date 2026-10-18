import { ApiError } from '../utils/ApiError';
import { roleAllows, type Action, type WorkspaceRole } from './roles';

type IdLike = string | { toString(): string };

/**
 * Who is acting and where. An Express request after authenticate() and
 * workspaceContext() satisfies this shape, so `assertCan(req, ...)` works.
 */
export interface PolicyContext {
  user?: { id: string } | null;
  workspace?: { _id: IdLike } | null;
  membership?: { role: WorkspaceRole; status: string; workspaceId?: IdLike } | null;
}

/** The fields of a deck, poll or session the policy looks at. */
export interface PolicyResource {
  workspaceId?: IdLike | null;
  creatorId?: IdLike | null;
}

export type PolicyDenial = 'unauthenticated' | 'not_member' | 'other_workspace' | 'role' | 'not_creator';
export type PolicyDecision = { allowed: true } | { allowed: false; reason: PolicyDenial };

const sameId = (a: IdLike | null | undefined, b: IdLike | null | undefined) =>
  a != null && b != null && String(a) === String(b);

/**
 * Decides whether the context may perform `action` (on `resource`, if given).
 *
 * - A resource without `workspaceId` predates workspaces (until migration 020
 *   backfills it): only its creator may act on it, whatever the action.
 * - Otherwise the caller needs an active membership of the current workspace,
 *   the resource must belong to that workspace, and the member's role must
 *   allow the action (roles.ts).
 */
export function evaluate(ctx: PolicyContext, action: Action, resource?: PolicyResource | null): PolicyDecision {
  const userId = ctx.user?.id;
  if (!userId) return { allowed: false, reason: 'unauthenticated' };

  if (resource && resource.workspaceId == null) {
    return sameId(resource.creatorId, userId) ? { allowed: true } : { allowed: false, reason: 'not_creator' };
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
  return roleAllows(membership.role, action) ? { allowed: true } : { allowed: false, reason: 'role' };
}

export const can = (ctx: PolicyContext, action: Action, resource?: PolicyResource | null): boolean =>
  evaluate(ctx, action, resource).allowed;

/**
 * Throws 401 without a user, 403 FORBIDDEN when the policy denies the action.
 * The denial reason is not sent: "belongs to another workspace" would confirm
 * that the resource exists.
 */
export function assertCan(ctx: PolicyContext, action: Action, resource?: PolicyResource | null): void {
  const decision = evaluate(ctx, action, resource);
  if (decision.allowed) return;
  if (decision.reason === 'unauthenticated') throw ApiError.unauthorized('Not authenticated');
  throw new ApiError(403, 'You do not have permission to perform this action', 'FORBIDDEN', { action });
}
