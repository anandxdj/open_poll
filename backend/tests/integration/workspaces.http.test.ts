import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { UserModel } from '../../src/modules/auth/auth.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** /api/workspaces through the real app: listing, plan gate, membership checks, switching. */
describeIntegration('workspaces API', () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    bob = await createVerifiedUser({ name: 'Bob' });
  });

  afterAll(async () => {
    await server?.close();
  });

  const call = async (user: TestUser | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await server.request(path, { method, headers: { ...(user?.headers ?? {}), ...headers }, body });
    return { status: res.status, body: (await res.json()) as any };
  };

  const createTeam = async (owner: TestUser, name = 'Acme') => {
    const res = await call(owner, 'POST', '/api/workspaces', { name });
    expect(res.status).toBe(201);
    return res.body.data;
  };

  it('requires authentication', async () => {
    expect((await call(null, 'GET', '/api/workspaces')).status).toBe(401);
    expect((await call(null, 'POST', '/api/workspaces', { name: 'X' })).status).toBe(401);
  });

  it('lists the personal workspace, provisioned on first use, as the default', async () => {
    const res = await call(alice, 'GET', '/api/workspaces');
    expect(res.status).toBe(200);
    const { workspaces, defaultWorkspaceId } = res.body.data;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ type: 'personal', role: 'owner', plan: 'free', isDefault: true, name: "Alice's workspace" });
    expect(defaultWorkspaceId).toBe(workspaces[0]._id);
    expect(String((await UserModel.findById(alice.id))!.defaultWorkspaceId)).toBe(defaultWorkspaceId);
  });

  it('creates a team workspace, lists it after the personal one, and gates a second free one', async () => {
    const team = await createTeam(alice, 'Acme');
    expect(team.workspace).toMatchObject({ name: 'Acme', type: 'team', plan: 'free', ownerId: alice.id });
    expect(team.membership).toEqual({ role: 'owner', status: 'active' });
    expect(team.permissions).toContain('workspace:billing');
    expect(team.entitlements.limits.seats).toBe(1);

    const list = (await call(alice, 'GET', '/api/workspaces')).body.data.workspaces;
    expect(list.map((ws: any) => [ws.type, ws.name])).toEqual([
      ['personal', "Alice's workspace"],
      ['team', 'Acme'],
    ]);

    const blocked = await call(alice, 'POST', '/api/workspaces', { name: 'Second' });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'singleSeatTeamWorkspaces', max: 1, plan: 'free', workspaceId: team.workspace._id },
    });

    await WorkspaceModel.updateOne({ _id: team.workspace._id }, { $set: { plan: 'team' } });
    expect((await call(alice, 'POST', '/api/workspaces', { name: 'Second' })).status).toBe(201);
  });

  it('rejects fields the client may not set', async () => {
    const res = await call(alice, 'POST', '/api/workspaces', { name: 'Acme', plan: 'enterprise' });
    expect(res.status).toBe(400);
    expect(await WorkspaceModel.countDocuments({ type: 'team' })).toBe(0);
  });

  it('shows a workspace only to its active members', async () => {
    const team = await createTeam(alice);
    const path = `/api/workspaces/${team.workspace._id}`;

    expect((await call(alice, 'GET', path)).body.data.workspace.name).toBe('Acme');
    for (const target of [path, `/api/workspaces/${new mongoose.Types.ObjectId()}`, '/api/workspaces/not-an-id']) {
      const res = await call(bob, 'GET', target);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('WORKSPACE_FORBIDDEN');
    }

    const member = await WorkspaceMemberModel.create({ workspaceId: team.workspace._id, userId: bob.id, role: 'viewer' });
    const asViewer = await call(bob, 'GET', path);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.data.membership.role).toBe('viewer');
    expect(asViewer.body.data.permissions).toEqual(['deck:read', 'session:read']);

    await WorkspaceMemberModel.updateOne({ _id: member._id }, { $set: { status: 'suspended' } });
    expect((await call(bob, 'GET', path)).status).toBe(403);
  });

  it('lets owners and admins rename, not editors', async () => {
    const team = await createTeam(alice);
    const path = `/api/workspaces/${team.workspace._id}`;
    await WorkspaceMemberModel.create({ workspaceId: team.workspace._id, userId: bob.id, role: 'editor' });

    const denied = await call(bob, 'PATCH', path, { name: 'Bobs' });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN', details: { action: 'workspace:manage' } });

    const renamed = await call(alice, 'PATCH', path, { name: 'Acme Inc', settings: { retentionDays: 30 } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.workspace).toMatchObject({ name: 'Acme Inc', settings: { retentionDays: 30 } });

    expect((await call(alice, 'PATCH', path, { settings: { retentionDays: 5000 } })).body.code).toBe('PLAN_LIMIT_REACHED');
    expect((await call(alice, 'PATCH', path, { plan: 'enterprise' })).status).toBe(400);
    expect((await WorkspaceModel.findById(team.workspace._id))!.plan).toBe('free');
  });

  it('switches the default workspace of members only', async () => {
    const team = await createTeam(alice);
    const notMine = await createTeam(bob, 'Bobs');

    expect((await call(alice, 'POST', `/api/workspaces/${notMine.workspace._id}/switch`)).status).toBe(403);

    const switched = await call(alice, 'POST', `/api/workspaces/${team.workspace._id}/switch`);
    expect(switched.status).toBe(200);
    expect(switched.body.data.workspace._id).toBe(team.workspace._id);

    const list = (await call(alice, 'GET', '/api/workspaces')).body.data;
    expect(list.defaultWorkspaceId).toBe(team.workspace._id);
    expect(list.workspaces.find((ws: any) => ws.isDefault).name).toBe('Acme');
    expect(String((await UserModel.findById(alice.id))!.defaultWorkspaceId)).toBe(team.workspace._id);
  });

  it('ignores a stale X-Workspace-Id on its own routes so the switcher can recover', async () => {
    const res = await call(alice, 'GET', '/api/workspaces', undefined, { 'X-Workspace-Id': String(new mongoose.Types.ObjectId()) });
    expect(res.status).toBe(200);
    expect(res.body.data.workspaces).toHaveLength(1);
  });
});
