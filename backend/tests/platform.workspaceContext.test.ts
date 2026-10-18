import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { workspaceContext } from '../src/common/tenancy/workspaceContext.middleware';
import { UserModel } from '../src/modules/auth/auth.model';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../src/modules/workspaces/workspaceMember.model';
import { captureNext, mockReq, mockRes } from './helpers/http';

/** In-memory collections; a filter matches when every field equals (null matches missing). */
const db = { users: [] as any[], workspaces: [] as any[], members: [] as any[] };
const matches = (doc: any, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([field, value]) => String(doc[field] ?? null) === String(value ?? null));
const id = () => new mongoose.Types.ObjectId();

const saved = {
  userFindById: UserModel.findById,
  userUpdateOne: UserModel.updateOne,
  wsFindOne: WorkspaceModel.findOne,
  wsCreate: WorkspaceModel.create,
  memberFindOne: WorkspaceMemberModel.findOne,
  memberUpsert: WorkspaceMemberModel.findOneAndUpdate,
};
let workspacesCreated = 0;

beforeEach(() => {
  db.users.length = 0;
  db.workspaces.length = 0;
  db.members.length = 0;
  workspacesCreated = 0;
  (UserModel as any).findById = (userId: unknown) => ({
    select: async () => db.users.find((user) => String(user._id) === String(userId)) ?? null,
  });
  (UserModel as any).updateOne = async (filter: any, update: any) => {
    const user = db.users.find((candidate) => matches(candidate, filter));
    if (user) Object.assign(user, update.$set);
    return { modifiedCount: user ? 1 : 0 };
  };
  (WorkspaceModel as any).findOne = async (filter: any) => db.workspaces.find((ws) => matches(ws, filter)) ?? null;
  (WorkspaceModel as any).create = async (data: any) => {
    workspacesCreated += 1;
    const workspace = { _id: id(), deletedAt: null, ...data };
    db.workspaces.push(workspace);
    return workspace;
  };
  (WorkspaceMemberModel as any).findOne = async (filter: any) => db.members.find((m) => matches(m, filter)) ?? null;
  (WorkspaceMemberModel as any).findOneAndUpdate = async (filter: any, update: any) => {
    let member = db.members.find((m) => matches(m, filter));
    if (!member) {
      member = { _id: id(), ...filter, ...update.$setOnInsert };
      db.members.push(member);
    }
    return member;
  };
});

afterEach(() => {
  (UserModel as any).findById = saved.userFindById;
  (UserModel as any).updateOne = saved.userUpdateOne;
  (WorkspaceModel as any).findOne = saved.wsFindOne;
  (WorkspaceModel as any).create = saved.wsCreate;
  (WorkspaceMemberModel as any).findOne = saved.memberFindOne;
  (WorkspaceMemberModel as any).findOneAndUpdate = saved.memberUpsert;
});

const addUser = (fields: Record<string, unknown> = {}) => {
  const user = { _id: id(), name: 'Grace', defaultWorkspaceId: null, ...fields };
  db.users.push(user);
  return user;
};
const addWorkspace = (fields: Record<string, unknown> = {}) => {
  const workspace = { _id: id(), name: 'Team', type: 'team', deletedAt: null, ...fields };
  db.workspaces.push(workspace);
  return workspace;
};
const addMember = (workspace: any, user: any, role = 'editor', status = 'active') => {
  const member = { _id: id(), workspaceId: workspace._id, userId: user._id, role, status };
  db.members.push(member);
  return member;
};

async function run(user: any, headers: Record<string, string> = {}) {
  const req: any = mockReq({ headers });
  if (user) req.user = { id: String(user._id), email: 'g@example.com', name: user.name, role: 'user' };
  const { next, calls } = captureNext();
  await workspaceContext()(req, mockRes() as any, next);
  return { req, error: calls[0] as any };
}

describe('workspaceContext middleware', () => {
  it('uses X-Workspace-Id when the user is an active member', async () => {
    const user = addUser();
    const team = addWorkspace();
    const member = addMember(team, user, 'presenter');
    const { req, error } = await run(user, { 'X-Workspace-Id': String(team._id) });
    expect(error).toBeUndefined();
    expect(req.workspace).toBe(team);
    expect(req.membership).toBe(member);
  });

  it('answers 403 WORKSPACE_FORBIDDEN for non-members, inactive members, deleted or malformed workspaces', async () => {
    const user = addUser();
    const foreign = addWorkspace();
    const suspended = addWorkspace();
    addMember(suspended, user, 'editor', 'suspended');
    const invited = addWorkspace();
    addMember(invited, user, 'editor', 'invited');
    const deleted = addWorkspace({ deletedAt: new Date() });
    addMember(deleted, user, 'owner');

    for (const header of [foreign._id, suspended._id, invited._id, deleted._id, 'not-an-id', '123456789012']) {
      const { req, error } = await run(user, { 'X-Workspace-Id': String(header) });
      expect(error).toMatchObject({ statusCode: 403, code: 'WORKSPACE_FORBIDDEN' });
      expect(req.workspace).toBeUndefined();
    }
  });

  it('uses the default workspace without a header', async () => {
    const team = addWorkspace();
    const user = addUser({ defaultWorkspaceId: team._id });
    addMember(team, user, 'admin');
    const { req, error } = await run(user);
    expect(error).toBeUndefined();
    expect(req.workspace).toBe(team);
    expect(workspacesCreated).toBe(0);
  });

  it('provisions the personal workspace on first use and makes it the default', async () => {
    const user = addUser();
    const { req, error } = await run(user);
    expect(error).toBeUndefined();
    expect(req.workspace).toMatchObject({ type: 'personal', name: "Grace's workspace" });
    expect(String(req.workspace.ownerId)).toBe(String(user._id));
    expect(req.workspace.slug).toMatch(/^grace-[0-9a-f]{6}$/);
    expect(req.membership).toMatchObject({ role: 'owner', status: 'active' });
    expect(String(user.defaultWorkspaceId)).toBe(String(req.workspace._id));

    // Later requests reuse it.
    const again = await run(user);
    expect(String(again.req.workspace._id)).toBe(String(req.workspace._id));
    expect(workspacesCreated).toBe(1);
  });

  it('falls back to the personal workspace when removed from the default one', async () => {
    const team = addWorkspace();
    const user = addUser({ defaultWorkspaceId: team._id });
    const { req, error } = await run(user);
    expect(error).toBeUndefined();
    expect(req.workspace.type).toBe('personal');
    expect(String(user.defaultWorkspaceId)).toBe(String(req.workspace._id));
  });

  it('requires authentication', async () => {
    const { error } = await run(null);
    expect(error).toMatchObject({ statusCode: 401 });
  });
});
