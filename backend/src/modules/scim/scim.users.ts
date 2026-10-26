import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { env } from '../../common/config/env';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel, type IUser } from '../auth/auth.model';
import { syncSeatsAfterMembershipChange } from '../billing/seatSync';
import { SsoConnectionModel } from '../sso/ssoConnection.model';
import { assertSeats, countActiveMembers } from '../workspaces/members.service';
import type { IWorkspace } from '../workspaces/workspace.model';
import { WorkspaceGroupModel } from '../workspaces/workspaceGroup.model';
import { WorkspaceMemberModel, type IWorkspaceMember } from '../workspaces/workspaceMember.model';
import { ScimError, SCIM_LIST_SCHEMA, USER_SCHEMA } from './scim.errors';
import { parseScimFilter, scimPage } from './scim.filter';

export interface ScimActor {
  workspace: IWorkspace;
  tokenId: string;
}

const actorOf = (scim: ScimActor) => ({ actorType: 'scim' as const, actorId: scim.tokenId, workspace: scim.workspace });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_FILTERS = ['userName', 'emails.value', 'externalId', 'displayName', 'active', 'id'] as const;

const location = (id: string) => `${env.apiPublicUrl}/scim/v2/Users/${id}`;

const isManagedHere = (user: IUser, workspace: IWorkspace) => String(user.scim?.workspaceId ?? '') === String(workspace._id);

export function userResource(user: IUser, membership: IWorkspaceMember, workspace: IWorkspace, groups: { id: string; displayName: string }[] = []) {
  const [givenName, ...rest] = user.name.split(' ');
  return {
    schemas: [USER_SCHEMA],
    id: String(user._id),
    ...(isManagedHere(user, workspace) && user.scim?.externalId ? { externalId: user.scim.externalId } : {}),
    userName: user.email,
    name: { formatted: user.name, givenName, familyName: rest.join(' ') },
    displayName: user.name,
    emails: [{ value: user.email, type: 'work', primary: true }],
    active: membership.status === 'active',
    groups: groups.map((g) => ({ value: g.id, display: g.displayName, $ref: `${env.apiPublicUrl}/scim/v2/Groups/${g.id}` })),
    meta: {
      resourceType: 'User',
      created: membership.createdAt.toISOString(),
      lastModified: (membership.updatedAt > (user as unknown as { updatedAt: Date }).updatedAt
        ? membership.updatedAt
        : (user as unknown as { updatedAt: Date }).updatedAt
      ).toISOString(),
      location: location(String(user._id)),
    },
  };
}

/** What a SCIM user body says about a person (POST/PUT, and PATCH values). */
interface UserInput {
  email?: string;
  name?: string;
  active?: boolean;
  externalId?: string | null;
}

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : undefined);

function readUser(body: Record<string, any>): UserInput {
  const emails = Array.isArray(body.emails) ? body.emails : [];
  const primary = emails.find((e: any) => e?.primary) ?? emails[0];
  const email = (asString(body.userName) ?? asString(primary?.value))?.toLowerCase();
  const name =
    asString(body.displayName) ??
    asString(body.name?.formatted) ??
    ([asString(body.name?.givenName), asString(body.name?.familyName)].filter(Boolean).join(' ') || undefined);
  return {
    email,
    name,
    active: typeof body.active === 'boolean' ? body.active : typeof body.active === 'string' ? body.active.toLowerCase() === 'true' : undefined,
    externalId: body.externalId === null ? null : asString(body.externalId),
  };
}

/** The role SCIM gives new members: the workspace's first SSO connection's default, else editor. */
async function defaultRole(workspace: IWorkspace) {
  const connection = await SsoConnectionModel.findOne({ workspaceId: workspace._id }).sort({ createdAt: 1 }).select('defaultRole').lean();
  return connection?.defaultRole ?? 'editor';
}

async function seatOrFail(workspace: IWorkspace) {
  try {
    assertSeats(workspace, (await countActiveMembers(workspace._id)) + 1);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PLAN_LIMIT_REACHED') throw new ScimError(403, 'The workspace has no free seat');
    throw error;
  }
}

async function groupsOf(workspace: IWorkspace, userId: Types.ObjectId) {
  const groups = await WorkspaceGroupModel.find({ workspaceId: workspace._id, memberIds: userId }).select('displayName').lean();
  return groups.map((g) => ({ id: String(g._id), displayName: g.displayName }));
}

async function memberOf(scim: ScimActor, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new ScimError(404, 'User not found');
  const membership = await WorkspaceMemberModel.findOne({ workspaceId: scim.workspace._id, userId: id });
  const user = membership ? await UserModel.findById(id) : null;
  if (!membership || !user || user.deletedAt) throw new ScimError(404, 'User not found');
  return { membership, user };
}

/** Deprovisioning: the membership is suspended and the person is signed out. */
async function applyActive(scim: ScimActor, user: IUser, membership: IWorkspaceMember, active: boolean) {
  if (active === (membership.status === 'active')) return;
  if (active) {
    await seatOrFail(scim.workspace);
    membership.status = 'active';
    if (isManagedHere(user, scim.workspace)) user.active = true;
  } else {
    if (membership.role === 'owner') throw new ScimError(400, 'The workspace owner cannot be deactivated over SCIM', 'mutability');
    membership.status = 'suspended';
    user.set('refreshToken', undefined);
    if (isManagedHere(user, scim.workspace)) user.active = false;
  }
  await membership.save();
  syncSeatsAfterMembershipChange(scim.workspace);
  void audit(actorOf(scim), active ? 'scim.user_activate' : 'scim.user_deactivate', { type: 'user', id: user._id }, { email: user.email });
}

async function applyInput(scim: ScimActor, user: IUser, membership: IWorkspaceMember, input: UserInput) {
  // Only accounts this workspace provisioned are renamed or re-addressed by its IdP.
  if (isManagedHere(user, scim.workspace)) {
    if (input.name) user.name = input.name;
    if (input.email && input.email !== user.email) {
      if (!EMAIL.test(input.email)) throw new ScimError(400, 'userName must be an email address', 'invalidValue');
      if (await UserModel.exists({ email: input.email, _id: { $ne: user._id } })) throw new ScimError(409, 'Another account has that email', 'uniqueness');
      user.email = input.email;
    }
    if (input.externalId !== undefined) user.scim = { workspaceId: scim.workspace._id, externalId: input.externalId ?? undefined };
  }
  if (input.active !== undefined) await applyActive(scim, user, membership, input.active);
  await user.save();
}

export const ScimUsers = {
  async list(scim: ScimActor, query: Record<string, unknown>) {
    const conditions = parseScimFilter(typeof query.filter === 'string' ? query.filter : undefined, USER_FILTERS);
    const { startIndex, count } = scimPage(query);
    const memberFilter: Record<string, unknown> = { workspaceId: scim.workspace._id };
    const userFilter: Record<string, unknown> = { deletedAt: null };
    for (const { attribute, value } of conditions) {
      if (attribute === 'active') memberFilter.status = value === true ? 'active' : { $ne: 'active' };
      else if (attribute === 'userName' || attribute === 'emails.value') userFilter.email = String(value).toLowerCase();
      else if (attribute === 'externalId') Object.assign(userFilter, { 'scim.externalId': String(value), 'scim.workspaceId': scim.workspace._id });
      else if (attribute === 'displayName') userFilter.name = String(value);
      else if (attribute === 'id') userFilter._id = Types.ObjectId.isValid(String(value)) ? String(value) : new Types.ObjectId();
    }
    const memberships = await WorkspaceMemberModel.find(memberFilter).sort({ createdAt: 1 });
    const users = await UserModel.find({ ...userFilter, _id: userFilter._id ?? { $in: memberships.map((m) => m.userId) } });
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const rows = memberships.filter((m) => byId.has(String(m.userId)));
    const page = rows.slice(startIndex - 1, startIndex - 1 + count);
    return {
      schemas: [SCIM_LIST_SCHEMA],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: page.length,
      Resources: await Promise.all(
        page.map(async (m) => userResource(byId.get(String(m.userId))!, m, scim.workspace, await groupsOf(scim.workspace, m.userId)))
      ),
    };
  },

  async get(scim: ScimActor, id: string) {
    const { user, membership } = await memberOf(scim, id);
    return userResource(user, membership, scim.workspace, await groupsOf(scim.workspace, user._id));
  },

  /** Creates the account (signs in through SSO, no password) or adds an existing one to the workspace. */
  async create(scim: ScimActor, body: Record<string, any>) {
    const input = readUser(body);
    if (!input.email || !EMAIL.test(input.email)) throw new ScimError(400, 'userName must be an email address', 'invalidValue');
    let user = await UserModel.findOne({ email: input.email });
    if (user?.deletedAt) throw new ScimError(409, 'That account was deleted', 'uniqueness');
    if (user && (await WorkspaceMemberModel.exists({ workspaceId: scim.workspace._id, userId: user._id }))) {
      throw new ScimError(409, 'The user is already in this workspace', 'uniqueness');
    }
    const active = input.active !== false;
    if (active) await seatOrFail(scim.workspace);
    if (!user) {
      user = await UserModel.create({
        email: input.email,
        name: input.name || input.email.split('@')[0],
        isVerified: true,
        role: 'user',
        defaultWorkspaceId: scim.workspace._id,
        scim: { workspaceId: scim.workspace._id, externalId: input.externalId ?? undefined },
      });
    }
    const membership = await WorkspaceMemberModel.create({
      workspaceId: scim.workspace._id,
      userId: user._id,
      role: await defaultRole(scim.workspace),
      status: active ? 'active' : 'suspended',
      source: 'scim',
    });
    syncSeatsAfterMembershipChange(scim.workspace);
    void audit(actorOf(scim), 'scim.user_create', { type: 'user', id: user._id }, { email: user.email, role: membership.role });
    return userResource(user, membership, scim.workspace);
  },

  async replace(scim: ScimActor, id: string, body: Record<string, any>) {
    const { user, membership } = await memberOf(scim, id);
    await applyInput(scim, user, membership, { ...readUser(body), active: readUser(body).active ?? true });
    return userResource(user, membership, scim.workspace, await groupsOf(scim.workspace, user._id));
  },

  /** PatchOp: replace/add of active, name, displayName, userName, emails, externalId (with or without a path). */
  async patch(scim: ScimActor, id: string, body: Record<string, any>) {
    const { user, membership } = await memberOf(scim, id);
    const operations = Array.isArray(body.Operations) ? body.Operations : null;
    if (!operations) throw new ScimError(400, 'Operations are required', 'invalidSyntax');
    const input: UserInput = {};
    for (const operation of operations) {
      const op = String(operation?.op ?? '').toLowerCase();
      if (op !== 'replace' && op !== 'add') throw new ScimError(400, `Unsupported operation ${op}`, 'invalidSyntax');
      const path = typeof operation.path === 'string' ? operation.path : null;
      const value = operation.value;
      const patch: Record<string, unknown> = path
        ? path === 'name.givenName' || path === 'name.familyName' || path === 'name.formatted'
          ? { name: { [path.split('.')[1]!]: value } }
          : path.startsWith('emails')
            ? { emails: Array.isArray(value) ? value : [{ value, primary: true }] }
            : { [path]: value }
        : (value ?? {});
      const read = readUser(patch);
      if (read.email !== undefined) input.email = read.email;
      if (read.name !== undefined) input.name = read.name;
      if (read.active !== undefined) input.active = read.active;
      if (read.externalId !== undefined) input.externalId = read.externalId;
    }
    await applyInput(scim, user, membership, input);
    return userResource(user, membership, scim.workspace, await groupsOf(scim.workspace, user._id));
  },

  /** Removes the person from the workspace (and its groups) and signs them out; the account stays. */
  async remove(scim: ScimActor, id: string) {
    const { user, membership } = await memberOf(scim, id);
    if (membership.role === 'owner') throw new ScimError(400, 'The workspace owner cannot be removed over SCIM', 'mutability');
    await membership.deleteOne();
    await WorkspaceGroupModel.updateMany({ workspaceId: scim.workspace._id }, { $pull: { memberIds: user._id } });
    user.set('refreshToken', undefined);
    if (isManagedHere(user, scim.workspace)) user.active = false;
    await user.save();
    syncSeatsAfterMembershipChange(scim.workspace);
    void audit(actorOf(scim), 'scim.user_delete', { type: 'user', id: user._id }, { email: user.email });
  },
};
