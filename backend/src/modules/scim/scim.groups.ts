import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { env } from '../../common/config/env';
import { UserModel } from '../auth/auth.model';
import { ResourceShareModel } from '../workspaces/resourceShare.model';
import { WorkspaceGroupModel, type IWorkspaceGroup } from '../workspaces/workspaceGroup.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { GROUP_SCHEMA, ScimError, SCIM_LIST_SCHEMA } from './scim.errors';
import { parseScimFilter, scimPage } from './scim.filter';
import type { ScimActor } from './scim.users';

const GROUP_FILTERS = ['displayName', 'externalId', 'id'] as const;
const actorOf = (scim: ScimActor) => ({ actorType: 'scim' as const, actorId: scim.tokenId, workspace: scim.workspace });

async function groupResource(group: IWorkspaceGroup, withMembers = true) {
  const users = withMembers ? await UserModel.find({ _id: { $in: group.memberIds } }).select('name email').lean() : [];
  return {
    schemas: [GROUP_SCHEMA],
    id: String(group._id),
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.displayName,
    members: users.map((u) => ({ value: String(u._id), display: u.name, $ref: `${env.apiPublicUrl}/scim/v2/Users/${u._id}` })),
    meta: {
      resourceType: 'Group',
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
      location: `${env.apiPublicUrl}/scim/v2/Groups/${group._id}`,
    },
  };
}

/** Member ids that are people in this workspace; others are ignored (the IdP may know more people). */
async function workspaceMembers(scim: ScimActor, values: unknown): Promise<Types.ObjectId[]> {
  const ids = (Array.isArray(values) ? values : [])
    .map((m: any) => (typeof m === 'string' ? m : m?.value))
    .filter((id): id is string => typeof id === 'string' && Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const members = await WorkspaceMemberModel.find({ workspaceId: scim.workspace._id, userId: { $in: ids } }).select('userId').lean();
  return members.map((m) => m.userId);
}

async function findGroup(scim: ScimActor, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new ScimError(404, 'Group not found');
  const group = await WorkspaceGroupModel.findOne({ _id: id, workspaceId: scim.workspace._id });
  if (!group) throw new ScimError(404, 'Group not found');
  return group;
}

const displayNameOf = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 256) throw new ScimError(400, 'displayName is required', 'invalidValue');
  return name;
};

const sameIds = (ids: Types.ObjectId[]) => [...new Map(ids.map((id) => [String(id), id])).values()];

export const ScimGroups = {
  async list(scim: ScimActor, query: Record<string, unknown>) {
    const conditions = parseScimFilter(typeof query.filter === 'string' ? query.filter : undefined, GROUP_FILTERS);
    const { startIndex, count } = scimPage(query);
    const filter: Record<string, unknown> = { workspaceId: scim.workspace._id };
    for (const { attribute, value } of conditions) {
      if (attribute === 'id') filter._id = Types.ObjectId.isValid(String(value)) ? String(value) : new Types.ObjectId();
      else filter[attribute] = String(value);
    }
    const excludeMembers = String(query.excludedAttributes ?? '').split(',').includes('members');
    const total = await WorkspaceGroupModel.countDocuments(filter);
    const groups = await WorkspaceGroupModel.find(filter).sort({ createdAt: 1 }).skip(startIndex - 1).limit(count);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: total,
      startIndex,
      itemsPerPage: groups.length,
      Resources: await Promise.all(groups.map((g) => groupResource(g, !excludeMembers))),
    };
  },

  async get(scim: ScimActor, id: string) {
    return groupResource(await findGroup(scim, id));
  },

  async create(scim: ScimActor, body: Record<string, any>) {
    const displayName = displayNameOf(body.displayName);
    if (await WorkspaceGroupModel.exists({ workspaceId: scim.workspace._id, displayName })) {
      throw new ScimError(409, 'A group with that name exists', 'uniqueness');
    }
    const group = await WorkspaceGroupModel.create({
      workspaceId: scim.workspace._id,
      displayName,
      externalId: typeof body.externalId === 'string' ? body.externalId : null,
      memberIds: await workspaceMembers(scim, body.members),
    });
    void audit(actorOf(scim), 'scim.group_create', { type: 'group', id: group._id }, { name: displayName, members: group.memberIds.length });
    return groupResource(group);
  },

  async replace(scim: ScimActor, id: string, body: Record<string, any>) {
    const group = await findGroup(scim, id);
    group.displayName = displayNameOf(body.displayName);
    if (body.externalId !== undefined) group.externalId = typeof body.externalId === 'string' ? body.externalId : null;
    group.memberIds = await workspaceMembers(scim, body.members);
    await group.save();
    void audit(actorOf(scim), 'scim.group_update', { type: 'group', id: group._id }, { name: group.displayName });
    return groupResource(group);
  },

  /** PatchOp: add or remove members (`members[value eq "id"]` or a value list), replace displayName, externalId or members. */
  async patch(scim: ScimActor, id: string, body: Record<string, any>) {
    const group = await findGroup(scim, id);
    const operations = Array.isArray(body.Operations) ? body.Operations : null;
    if (!operations) throw new ScimError(400, 'Operations are required', 'invalidSyntax');
    for (const operation of operations) {
      const op = String(operation?.op ?? '').toLowerCase();
      const path = typeof operation.path === 'string' ? operation.path : '';
      const filtered = /^members\[value eq "([^"]+)"\]$/i.exec(path);
      if (op === 'add' && path.toLowerCase() === 'members') {
        group.memberIds = sameIds([...group.memberIds, ...(await workspaceMembers(scim, operation.value))]);
      } else if (op === 'remove' && (filtered || path.toLowerCase() === 'members')) {
        const drop = new Set(filtered ? [filtered[1]!] : (Array.isArray(operation.value) ? operation.value : []).map((m: any) => String(m?.value ?? m)));
        group.memberIds = path.toLowerCase() === 'members' && !operation.value ? [] : group.memberIds.filter((m) => !drop.has(String(m)));
      } else if (op === 'replace' || op === 'add') {
        const value = path ? { [path]: operation.value } : (operation.value ?? {});
        if (value.displayName !== undefined) group.displayName = displayNameOf(value.displayName);
        if (value.externalId !== undefined) group.externalId = typeof value.externalId === 'string' ? value.externalId : null;
        if (value.members !== undefined) group.memberIds = await workspaceMembers(scim, value.members);
      } else {
        throw new ScimError(400, `Unsupported operation ${op} ${path}`.trim(), 'invalidSyntax');
      }
    }
    await group.save();
    void audit(actorOf(scim), 'scim.group_update', { type: 'group', id: group._id }, { name: group.displayName });
    return groupResource(group);
  },

  async remove(scim: ScimActor, id: string) {
    const group = await findGroup(scim, id);
    await group.deleteOne();
    // Decks and folders shared with the group lose that share.
    await ResourceShareModel.deleteMany({ workspaceId: scim.workspace._id, principalType: 'group', principalId: group._id });
    void audit(actorOf(scim), 'scim.group_delete', { type: 'group', id: group._id }, { name: group.displayName });
  },
};
