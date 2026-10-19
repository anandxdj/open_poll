import mongoose, { type Types } from 'mongoose';
import { assertCan, can, type PolicyResource } from '../../common/tenancy/policy';
import { ROLE_RANK, SHARE_PERMISSIONS, type ShareRole, type WorkspaceRole } from '../../common/tenancy/roles';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { getPresentationById } from '../presentations/access';
import type { PutSharesInput, ShareQuery } from './members.schema';
import type { MembersActor } from './members.service';
import { ResourceShareModel, type SharePrincipalType, type ShareResourceType } from './resourceShare.model';
import { WorkspaceGroupModel } from './workspaceGroup.model';
import { WorkspaceMemberModel } from './workspaceMember.model';

/** The caller after authenticate() + workspaceContext() (the X-Workspace-Id workspace, like the deck routes). */
export type SharingActor = MembersActor;

/** What is being shared. */
export interface SharedResource {
  type: ShareResourceType;
  id: string;
  title: string;
}

export interface ShareView {
  principalType: SharePrincipalType;
  principalId: string;
  role: ShareRole;
  name: string;
  /** Users only. */
  email: string | null;
  /** Users only: the role they hold in the workspace, which a share can raise but never lower. */
  workspaceRole: WorkspaceRole | null;
}

export interface ShareGroupOption {
  id: string;
  name: string;
  memberCount: number;
}

/** GET|PUT /api/shares. */
export interface ShareList {
  resource: SharedResource;
  shares: ShareView[];
  /** Groups of the workspace the resource can be shared with (members come from GET /members). */
  groups: ShareGroupOption[];
}

/** One change PUT made, for the audit trail. */
export interface ShareChange {
  kind: 'grant' | 'update' | 'revoke';
  principalType: SharePrincipalType;
  principalId: string;
  role: ShareRole | null;
  previousRole: ShareRole | null;
}

interface LoadedResource {
  view: SharedResource;
  policy: PolicyResource & { _id: Types.ObjectId };
  workspaceId: Types.ObjectId;
}

const FOLDERS_COLLECTION = 'folders';

/**
 * The deck or folder to share. Decks come from the presentations module;
 * folders belong to W3-B2 and are read through the raw collection so this
 * module needs no folder model: a folder shares only inside its workspace.
 */
async function loadResource(actor: SharingActor, { resourceType, resourceId }: ShareQuery): Promise<LoadedResource> {
  if (resourceType === 'presentation') {
    const deck = await getPresentationById(resourceId);
    if (!deck.workspaceId) {
      throw new ApiError(409, "This deck doesn't belong to a workspace yet, so it can't be shared", 'NOT_SHAREABLE');
    }
    return {
      view: { type: 'presentation', id: String(deck._id), title: deck.title },
      policy: { _id: deck._id, workspaceId: deck.workspaceId, creatorId: deck.creatorId, folderId: deck.folderId },
      workspaceId: deck.workspaceId,
    };
  }
  const _id = new mongoose.Types.ObjectId(resourceId);
  const folder = await mongoose.connection
    .collection<{ _id: Types.ObjectId; workspaceId?: Types.ObjectId | null; name?: string; deletedAt?: Date | null }>(FOLDERS_COLLECTION)
    .findOne({ _id });
  if (!folder || folder.deletedAt || !folder.workspaceId) throw ApiError.notFound('Folder not found');
  return {
    view: { type: 'folder', id: String(_id), title: folder.name ?? 'Folder' },
    policy: { _id, workspaceId: folder.workspaceId, kind: 'folder' },
    workspaceId: folder.workspaceId,
  };
}

async function toList(resource: LoadedResource): Promise<ShareList> {
  const shares = await ResourceShareModel.find({
    resourceType: resource.view.type,
    resourceId: resource.policy._id,
    workspaceId: resource.workspaceId,
  }).lean();

  const userIds = shares.filter((share) => share.principalType === 'user').map((share) => share.principalId);
  const [users, members, groups] = await Promise.all([
    userIds.length ? UserModel.find({ _id: { $in: userIds } }).select('name email').lean() : [],
    userIds.length
      ? WorkspaceMemberModel.find({ workspaceId: resource.workspaceId, userId: { $in: userIds } }).select('userId role').lean()
      : [],
    WorkspaceGroupModel.find({ workspaceId: resource.workspaceId }).select('displayName memberIds').sort({ displayName: 1 }).limit(500).lean(),
  ]);
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const roleById = new Map(members.map((member) => [String(member.userId), member.role]));
  const groupById = new Map(groups.map((group) => [String(group._id), group]));

  const views = shares.flatMap((share): ShareView[] => {
    const principalId = String(share.principalId);
    if (share.principalType === 'user') {
      const user = userById.get(principalId);
      if (!user) return [];
      return [
        {
          principalType: 'user',
          principalId,
          role: share.role,
          name: user.name,
          email: user.email,
          workspaceRole: roleById.get(principalId) ?? null,
        },
      ];
    }
    const group = groupById.get(principalId);
    if (!group) return [];
    return [{ principalType: 'group', principalId, role: share.role, name: group.displayName, email: null, workspaceRole: null }];
  });
  views.sort((a, b) => a.principalType.localeCompare(b.principalType) || a.name.localeCompare(b.name));

  return {
    resource: resource.view,
    shares: views,
    groups: groups.map((group) => ({ id: String(group._id), name: group.displayName, memberCount: group.memberIds.length })),
  };
}

const key = (principalType: string, principalId: unknown) => `${principalType}:${String(principalId).toLowerCase()}`;

export class SharingService {
  /** Who the deck or folder is shared with. Needs `deck:share` (editors and up), in the resource's workspace. */
  static async list(actor: SharingActor, query: ShareQuery): Promise<ShareList> {
    const resource = await loadResource(actor, query);
    assertCan(actor, 'deck:share', resource.policy);
    return toList(resource);
  }

  /**
   * Replaces the complete set of grants on the deck or folder.
   *
   * - The caller needs `deck:share` there, and may only grant a role whose
   *   permissions they hold on the resource themselves: a share can raise
   *   someone's access up to the granter's, never beyond it.
   * - Principals must belong to the resource's workspace: active members, or
   *   its groups. Sharing never reaches into another workspace.
   * - Applied as a diff, so a principal's other shares and concurrent edits to
   *   other principals are untouched. Returns the new list and what changed.
   */
  static async replace(
    actor: SharingActor,
    query: ShareQuery,
    input: PutSharesInput,
  ): Promise<{ list: ShareList; changes: ShareChange[] }> {
    const resource = await loadResource(actor, query);
    assertCan(actor, 'deck:share', resource.policy);

    for (const { role } of input.shares) {
      const missing = [...SHARE_PERMISSIONS[role]].find((action) => !can(actor, action, resource.policy));
      if (missing || ROLE_RANK[role] > ROLE_RANK[actor.membership.role]) {
        throw new ApiError(403, `You can't grant the ${role} role on this resource`, 'ROLE_NOT_ASSIGNABLE', { role });
      }
    }

    await assertPrincipalsInWorkspace(resource.workspaceId, input);

    const scope = { resourceType: resource.view.type, resourceId: resource.policy._id };
    const existing = await ResourceShareModel.find({ ...scope, workspaceId: resource.workspaceId }).lean();
    const before = new Map(existing.map((share) => [key(share.principalType, share.principalId), share]));
    const wanted = new Map(input.shares.map((share) => [key(share.principalType, share.principalId), share]));

    const changes: ShareChange[] = [];
    const operations: Parameters<typeof ResourceShareModel.bulkWrite>[0] = [];
    for (const [id, share] of wanted) {
      const current = before.get(id);
      if (current?.role === share.role) continue;
      changes.push({
        kind: current ? 'update' : 'grant',
        principalType: share.principalType,
        principalId: share.principalId,
        role: share.role,
        previousRole: current?.role ?? null,
      });
      operations.push({
        updateOne: {
          filter: { ...scope, principalType: share.principalType, principalId: new mongoose.Types.ObjectId(share.principalId) },
          update: { $set: { role: share.role, workspaceId: resource.workspaceId } },
          upsert: true,
        },
      });
    }
    for (const [id, share] of before) {
      if (wanted.has(id)) continue;
      changes.push({
        kind: 'revoke',
        principalType: share.principalType,
        principalId: String(share.principalId),
        role: null,
        previousRole: share.role,
      });
      operations.push({ deleteOne: { filter: { _id: share._id } } });
    }
    if (operations.length > 0) await ResourceShareModel.bulkWrite(operations, { ordered: false });

    return { list: await toList(resource), changes };
  }
}

/** 400 PRINCIPAL_NOT_IN_WORKSPACE unless every user is an active member and every group belongs to the workspace. */
async function assertPrincipalsInWorkspace(workspaceId: Types.ObjectId, input: PutSharesInput): Promise<void> {
  const userIds = input.shares.filter((share) => share.principalType === 'user').map((share) => share.principalId);
  const groupIds = input.shares.filter((share) => share.principalType === 'group').map((share) => share.principalId);
  const [members, groups] = await Promise.all([
    userIds.length ? WorkspaceMemberModel.find({ workspaceId, userId: { $in: userIds }, status: 'active' }).select('userId').lean() : [],
    groupIds.length ? WorkspaceGroupModel.find({ workspaceId, _id: { $in: groupIds } }).select('_id').lean() : [],
  ]);
  const known = new Set([...members.map((member) => String(member.userId)), ...groups.map((group) => String(group._id))]);
  const unknown = [...userIds, ...groupIds].filter((id) => !known.has(id.toLowerCase()));
  if (unknown.length > 0) {
    throw new ApiError(400, 'Share only with active members and groups of this workspace', 'PRINCIPAL_NOT_IN_WORKSPACE', {
      principalIds: unknown,
    });
  }
}
