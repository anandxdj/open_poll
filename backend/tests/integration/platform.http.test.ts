import { afterAll, beforeAll, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { UserModel } from '../../src/modules/auth/auth.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** The W0-D routes through the real app: mounts, middleware order, error codes. */
describeIntegration('platform routes over HTTP', () => {
  let server: TestServer;
  let user: TestUser;

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
    user = await createVerifiedUser();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  const presign = (headers: Record<string, string>, body: unknown = { purpose: 'slide_image', mime: 'image/png', bytes: 100 }) =>
    server.request('/api/uploads/presign', { method: 'POST', headers, body });

  it('serves the deployment capabilities publicly', async () => {
    const res = await server.request('/api/capabilities');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, boolean> };
    expect(Object.keys(body.data).sort()).toEqual(
      ['ai', 'billing', 'customDomains', 'googleDriveImport', 'metrics', 'pptxHighFidelity', 'samlSso', 'scim', 'storage'].sort(),
    );
    expect(body.data.storage).toBe(false);
  });

  it('requires authentication for uploads', async () => {
    expect((await presign({})).status).toBe(401);
  });

  it('answers 503 STORAGE_DISABLED without storage, after provisioning the personal workspace', async () => {
    const res = await presign(user.headers);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ success: false, code: 'STORAGE_DISABLED' });

    const workspace = await WorkspaceModel.findOne({ ownerId: user.id, type: 'personal' });
    expect(workspace).not.toBeNull();
    expect(String((await UserModel.findById(user.id))!.defaultWorkspaceId)).toBe(String(workspace!._id));
  });

  it('validates the body before touching storage', async () => {
    const res = await presign(user.headers, { purpose: 'secret_plans', mime: 'image/png', bytes: 1 });
    expect(res.status).toBe(400);
  });

  it('rejects an X-Workspace-Id the user is not an active member of', async () => {
    const other = await createVerifiedUser();
    const team = await WorkspaceModel.create({
      name: 'Team',
      slug: `team-${new mongoose.Types.ObjectId().toString()}`,
      type: 'team',
      ownerId: other.id,
    });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: other.id, role: 'owner' });

    const res = await presign({ ...user.headers, 'X-Workspace-Id': String(team._id) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });
});
