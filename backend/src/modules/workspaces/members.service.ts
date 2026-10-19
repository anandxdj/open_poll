import type { Types } from 'mongoose';
import { assertLimit, getEntitlements } from '../../common/plans/entitlements';
import { assertCan, can } from '../../common/tenancy/policy';
import { ROLE_RANK, type MemberStatus, type WorkspaceRole } from '../../common/tenancy/roles';
import type { WorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { syncSeatsAfterMembershipChange } from '../billing/seatSync';
import { ResourceShareModel } from './resourceShare.model';
import type { UpdateMemberInput } from './members.schema';
import { WorkspaceModel, type IWorkspace } from './workspace.model';
import { WorkspaceInviteModel } from './workspaceInvite.model';
import { WorkspaceMemberModel, type IWorkspaceMember, type MemberSource } from './workspaceMember.model';

/** The caller acting on the workspace named in the path (after pathWorkspaceContext()). */
export interface MembersActor extends WorkspaceContext {
  user: { id: string; name?: string };
}

/** One row of GET /api/workspaces/:workspaceId/members. */
export interface MemberView {
  userId: string;
  name: string;
  email: string;
  picture: string | null;
  role: WorkspaceRole;
  status: MemberStatus;
  source: MemberSource;
  joinedAt: Date;
  /** `workspace.ownerId`: the billing contact, changed only by an explicit ownership transfer. */
  isPrimaryOwner: boolean;
}

export interface MemberList {
  members: MemberView[];
  /** used = active members, pending = unexpired invites, limit = the plan's seats (null = unlimited). */
  seats: { used: number; pending: number; limit: number | null };
  /** The caller may change roles, remove members and send invites. */
  canManage: boolean;
}

/** Most members a list returns; workspaces past this are SCIM-managed enterprises (pagination then). */
export const MEMBER_LIST_LIMIT = 2000;

const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

export const personalWorkspaceError = () =>
  new ApiError(
    403,
    "Personal workspaces can't have other members. Create a team workspace to work with others.",
    'PERSONAL_WORKSPACE',
  );

const roleNotAssignable = (message: string) => new ApiError(403, message, 'ROLE_NOT_ASSIGNABLE');

/**
 * Why `actorRole` may not change a member from `targetRole` (to `nextRole`),
 * or null when it may. Managers act on members up to their own rank, assign
 * roles up to their own rank, and only owners touch the owner role.
 * (The caller must hold `workspace:members` for anyone but themselves.)
 */
export function memberChangeDenial(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  nextRole?: WorkspaceRole,
): string | null {
  if (targetRole === 'owner' && actorRole !== 'owner') return 'Only owners can change or remove an owner';
  if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole]) return "You can't change a member whose role is above yours";
  if (nextRole !== undefined) {
    if (nextRole === 'owner' && actorRole !== 'owner') return 'Only owners can make someone an owner';
    if (ROLE_RANK[nextRole] > ROLE_RANK[actorRole]) return "You can't assign a role above your own";
  }
  return null;
}

const toView = (
  workspace: IWorkspace,
  member: Pick<IWorkspaceMember, 'userId' | 'role' | 'status' | 'source' | 'createdAt'>,
  user: { name: string; email: string; picture?: string | null },
): MemberView => ({
  userId: String(member.userId),
  name: user.name,
  email: user.email,
  picture: user.picture ?? null,
  role: member.role,
  status: member.status,
  source: member.source,
  joinedAt: member.createdAt,
  isPrimaryOwner: sameId(workspace.ownerId, member.userId),
});

/** Active members (they use seats). */
export const countActiveMembers = (workspaceId: Types.ObjectId | string) =>
  WorkspaceMemberModel.countDocuments({ workspaceId, status: 'active' });

/** Unexpired invites (each reserves a seat until accepted, revoked or expired). */
export const countPendingInvites = (workspaceId: Types.ObjectId | string, exceptEmail?: string) =>
  WorkspaceInviteModel.countDocuments({
    workspaceId,
    expiresAt: { $gt: new Date() },
    ...(exceptEmail ? { email: { $ne: exceptEmail } } : {}),
  });

/** 403 PLAN_LIMIT_REACHED (limit `seats`) when `n` seats would exceed the workspace plan. */
export const assertSeats = (workspace: IWorkspace, n: number) => assertLimit(workspace, 'seats', n);

async function findMember(workspaceId: Types.ObjectId, userId: string): Promise<IWorkspaceMember> {
  const member = /^[a-f0-9]{24}$/i.test(userId) ? await WorkspaceMemberModel.findOne({ workspaceId, userId }) : null;
  if (!member) throw new ApiError(404, 'Member not found', 'MEMBER_NOT_FOUND');
  return member;
}

/**
 * Keeps at least one active owner and the primary owner in place:
 * - the primary owner (`workspace.ownerId`) cannot be demoted, suspended or
 *   removed; ownership is transferred explicitly first (409 PRIMARY_OWNER);
 * - the last active owner cannot stop being one (409 LAST_OWNER).
 * `next` null = the membership is being removed.
 */
async function assertOwnersRemain(
  workspace: IWorkspace,
  target: IWorkspaceMember,
  next: { role: WorkspaceRole; status: MemberStatus } | null,
): Promise<void> {
  const staysActiveOwner = next !== null && next.role === 'owner' && next.status === 'active';
  if (staysActiveOwner) return;
  if (sameId(workspace.ownerId, target.userId)) {
    throw new ApiError(
      409,
      'The primary owner must transfer ownership to another member first',
      'PRIMARY_OWNER',
    );
  }
  if (target.role === 'owner' && target.status === 'active') {
    const otherOwners = await WorkspaceMemberModel.countDocuments({
      workspaceId: workspace._id,
      role: 'owner',
      status: 'active',
      userId: { $ne: target.userId },
    });
    if (otherOwners === 0) throw new ApiError(409, 'A workspace needs at least one owner', 'LAST_OWNER');
  }
}

/** Removes the user's direct share grants in the workspace (they would apply again on a later re-join). */
const dropUserShares = (workspaceId: Types.ObjectId, userId: Types.ObjectId | string) =>
  ResourceShareModel.deleteMany({ workspaceId, principalType: 'user', principalId: userId });

async function viewOf(workspace: IWorkspace, member: IWorkspaceMember): Promise<MemberView> {
  const user = await UserModel.findById(member.userId).select('name email picture').lean();
  return toView(workspace, member, user ?? { name: 'Former user', email: '' });
}

export class MembersService {
  static async list(actor: MembersActor): Promise<MemberList> {
    const { workspace } = actor;
    const members = await WorkspaceMemberModel.find({ workspaceId: workspace._id })
      .limit(MEMBER_LIST_LIMIT)
      .lean();
    const users = await UserModel.find({ _id: { $in: members.map((member) => member.userId) } })
      .select('name email picture')
      .lean();
    const byId = new Map(users.map((user) => [String(user._id), user]));

    const views = members.flatMap((member): MemberView[] => {
      const user = byId.get(String(member.userId));
      return user ? [toView(workspace, member, user)] : [];
    });
    // Highest role first, then by name.
    views.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name));

    const [used, pending] = await Promise.all([countActiveMembers(workspace._id), countPendingInvites(workspace._id)]);
    return {
      members: views,
      seats: { used, pending, limit: getEntitlements(workspace).limits.seats },
      canManage: can(actor, 'workspace:members'),
    };
  }

  /**
   * Changes a member's role and/or status. Needs `workspace:members` and the
   * rank rules of memberChangeDenial(); keeps an owner (assertOwnersRemain);
   * reactivating a member takes a seat.
   */
  static async update(
    actor: MembersActor,
    userId: string,
    input: UpdateMemberInput,
  ): Promise<{ before: { role: WorkspaceRole; status: MemberStatus }; member: MemberView }> {
    assertCan(actor, 'workspace:members');
    const { workspace } = actor;
    const target = await findMember(workspace._id, userId);
    const before = { role: target.role, status: target.status };
    const next = { role: input.role ?? target.role, status: (input.status ?? target.status) as MemberStatus };

    const denial = memberChangeDenial(actor.membership.role, target.role, input.role);
    if (denial) throw roleNotAssignable(denial);
    if (sameId(target.userId, actor.user.id) && next.status === 'suspended') {
      throw ApiError.badRequest("You can't suspend yourself");
    }
    if (next.role === before.role && next.status === before.status) {
      return { before, member: await viewOf(workspace, target) };
    }

    await assertOwnersRemain(workspace, target, next);
    if (before.status !== 'active' && next.status === 'active') {
      assertSeats(workspace, (await countActiveMembers(workspace._id)) + 1);
    }

    // Conditional on the state checked above, so two concurrent changes cannot both pass the owner guard.
    const member = await WorkspaceMemberModel.findOneAndUpdate(
      { _id: target._id, role: before.role, status: before.status },
      { $set: { role: next.role, status: next.status } },
      { returnDocument: 'after', runValidators: true },
    );
    if (!member) throw new ApiError(409, 'The member was changed by someone else; reload and try again', 'CONFLICT');
    // A reactivated member takes a seat again: make sure a per-seat subscription covers them (no-op without Stripe).
    if (before.status !== 'active' && next.status === 'active') syncSeatsAfterMembershipChange(workspace);
    return { before, member: await viewOf(workspace, member) };
  }

  /**
   * Removes a member, or lets a member leave (`userId` = the caller). Removing
   * someone else needs `workspace:members` and the rank rules. The primary and
   * the last owner stay. Their direct share grants in the workspace go too.
   */
  static async remove(actor: MembersActor, userId: string): Promise<{ member: IWorkspaceMember; self: boolean }> {
    const { workspace } = actor;
    const self = userId === actor.user.id;
    if (!self) assertCan(actor, 'workspace:members');
    const target = await findMember(workspace._id, userId);
    if (!self) {
      const denial = memberChangeDenial(actor.membership.role, target.role);
      if (denial) throw roleNotAssignable(denial);
    }
    await assertOwnersRemain(workspace, target, null);

    const removed = await WorkspaceMemberModel.findOneAndDelete({ _id: target._id, role: target.role, status: target.status });
    if (!removed) throw new ApiError(409, 'The member was changed by someone else; reload and try again', 'CONFLICT');
    await dropUserShares(workspace._id, target.userId);
    return { member: removed, self };
  }

  /**
   * Makes another active member the primary owner (`workspace.ownerId`, the
   * billing contact). Only the current primary owner may; the target becomes
   * an owner and the caller stays one (they may step down afterwards).
   */
  static async transferOwnership(actor: MembersActor, userId: string): Promise<{ workspace: IWorkspace; member: MemberView }> {
    const { workspace } = actor;
    if (workspace.type === 'personal') throw personalWorkspaceError();
    if (!sameId(workspace.ownerId, actor.user.id) || actor.membership.role !== 'owner') {
      throw new ApiError(403, 'Only the primary owner can transfer ownership', 'NOT_PRIMARY_OWNER');
    }
    if (userId === actor.user.id) throw ApiError.badRequest('You are already the primary owner');
    const target = await findMember(workspace._id, userId);
    if (target.status !== 'active') throw ApiError.badRequest('Only an active member can become the owner');

    const member =
      target.role === 'owner'
        ? target
        : await WorkspaceMemberModel.findOneAndUpdate(
            { _id: target._id, status: 'active' },
            { $set: { role: 'owner' } },
            { returnDocument: 'after' },
          );
    if (!member) throw new ApiError(409, 'The member was changed by someone else; reload and try again', 'CONFLICT');

    const updated = await WorkspaceModel.findOneAndUpdate(
      { _id: workspace._id, ownerId: workspace.ownerId, deletedAt: null },
      { $set: { ownerId: member.userId } },
      { returnDocument: 'after' },
    );
    if (!updated) throw new ApiError(409, 'Ownership changed in the meantime; reload and try again', 'CONFLICT');
    return { workspace: updated, member: await viewOf(updated, member) };
  }
}
