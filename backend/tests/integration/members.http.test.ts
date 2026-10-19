import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { UserModel } from '../../src/modules/auth/auth.model';
import { hashInviteToken } from '../../src/modules/workspaces/invites.service';
import { ResourceShareModel } from '../../src/modules/workspaces/resourceShare.model';
import { WorkspaceGroupModel } from '../../src/modules/workspaces/workspaceGroup.model';
import { WorkspaceInviteModel } from '../../src/modules/workspaces/workspaceInvite.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { PresentationModel } from '../../src/modules/presentations/models/presentation.model';
import migration100 from '../../src/migrations/100-workspace-invites';
import { createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

const inviteToken = (inviteUrl: string) => inviteUrl.split('/invites/')[1]!;

/** Members, invitations, resource shares and the audit log through the real app. */
describeIntegration('members, invites, shares and audit', () => {
  let server: TestServer;
  let alice: TestUser; // owner of the team workspace
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let wsId: string;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  const call = async (user: TestUser | null, method: string, path: string, body?: unknown, workspaceId?: string) => {
    const headers: Record<string, string> = { ...(user?.headers ?? {}) };
    if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
    const res = await server.request(path, { method, headers, body });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  const members = (_user?: TestUser) => `/api/workspaces/${wsId}/members`;
  const addMember = (user: TestUser, role: 'owner' | 'admin' | 'editor' | 'presenter' | 'viewer') =>
    WorkspaceMemberModel.create({ workspaceId: wsId, userId: user.id, role });
  const roleOf = async (user: TestUser) => (await WorkspaceMemberModel.findOne({ workspaceId: wsId, userId: user.id }))?.role;

  /** Audit events are written fire-and-forget; wait for the one(s) a test expects. */
  const auditEvents = async (filter: Record<string, unknown>, count = 1) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const events = await AuditEventModel.find({ workspaceId: wsId, ...filter }).sort({ createdAt: 1 }).lean();
      if (events.length >= count) return events;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return AuditEventModel.find({ workspaceId: wsId, ...filter }).lean();
  };

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    bob = await createVerifiedUser({ name: 'Bob' });
    carol = await createVerifiedUser({ name: 'Carol' });
    dave = await createVerifiedUser({ name: 'Dave' });
    const created = await call(alice, 'POST', '/api/workspaces', { name: 'Acme' });
    expect(created.status).toBe(201);
    wsId = created.body.data.workspace._id;
    // Free team workspaces have one seat; Team has five.
    await WorkspaceModel.updateOne({ _id: wsId }, { $set: { plan: 'team' } });
  });

  describe('members', () => {
    it('lists members with seats, ordered by role, for any active member', async () => {
      await addMember(bob, 'viewer');
      await addMember(carol, 'editor');

      const asOwner = await call(alice, 'GET', members(alice));
      expect(asOwner.status).toBe(200);
      expect(asOwner.body.data.members.map((m: any) => [m.name, m.role])).toEqual([
        ['Alice', 'owner'],
        ['Carol', 'editor'],
        ['Bob', 'viewer'],
      ]);
      expect(asOwner.body.data.members[0]).toMatchObject({ email: alice.email, isPrimaryOwner: true, status: 'active', source: 'manual' });
      expect(asOwner.body.data.seats).toEqual({ used: 3, pending: 0, limit: 5 });
      expect(asOwner.body.data.canManage).toBe(true);

      const asViewer = await call(bob, 'GET', members(bob));
      expect(asViewer.status).toBe(200);
      expect(asViewer.body.data.canManage).toBe(false);
    });

    it('is closed to non-members, suspended members and the unauthenticated', async () => {
      await addMember(bob, 'viewer');
      const outsider = await call(dave, 'GET', members(dave));
      expect(outsider.status).toBe(403);
      expect(outsider.body.code).toBe('WORKSPACE_FORBIDDEN');
      expect((await call(null, 'GET', members(alice))).status).toBe(401);

      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: bob.id }, { $set: { status: 'suspended' } });
      expect((await call(bob, 'GET', members(bob))).status).toBe(403);
    });

    it('changes roles by rank: owners and admins manage, editors do not, nobody exceeds their own role', async () => {
      await addMember(bob, 'admin');
      await addMember(carol, 'editor');
      await addMember(dave, 'viewer');

      const denied = await call(carol, 'PATCH', `${members(carol)}/${dave.id}`, { role: 'editor' });
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: 'FORBIDDEN', details: { action: 'workspace:members' } });

      // An admin may promote up to admin, not to owner, and may not touch the owner.
      expect((await call(bob, 'PATCH', `${members(bob)}/${dave.id}`, { role: 'admin' })).status).toBe(200);
      expect(await roleOf(dave)).toBe('admin');
      const toOwner = await call(bob, 'PATCH', `${members(bob)}/${carol.id}`, { role: 'owner' });
      expect(toOwner).toMatchObject({ status: 403, body: { code: 'ROLE_NOT_ASSIGNABLE' } });
      const touchOwner = await call(bob, 'PATCH', `${members(bob)}/${alice.id}`, { role: 'viewer' });
      expect(touchOwner).toMatchObject({ status: 403, body: { code: 'ROLE_NOT_ASSIGNABLE' } });
      expect((await call(bob, 'DELETE', `${members(bob)}/${alice.id}`)).status).toBe(403);

      // The owner may make a second owner.
      const promoted = await call(alice, 'PATCH', `${members(alice)}/${carol.id}`, { role: 'owner' });
      expect(promoted.status).toBe(200);
      expect(promoted.body.data.member).toMatchObject({ userId: carol.id, role: 'owner' });
    });

    it('validates the body strictly', async () => {
      await addMember(bob, 'viewer');
      const path = `${members(alice)}/${bob.id}`;
      for (const body of [{}, { role: 'superuser' }, { status: 'invited' }, { role: 'editor', workspaceId: wsId }, { plan: 'enterprise' }]) {
        expect((await call(alice, 'PATCH', path, body)).status).toBe(400);
      }
      expect((await call(alice, 'PATCH', `${members(alice)}/${new mongoose.Types.ObjectId()}`, { role: 'editor' })).body.code).toBe('MEMBER_NOT_FOUND');
      expect((await call(alice, 'PATCH', `${members(alice)}/not-an-id`, { role: 'editor' })).status).toBe(404);
    });

    it('never leaves a workspace without an owner', async () => {
      await addMember(bob, 'owner');
      // Alice is the primary owner: she must transfer ownership before she can step down or leave.
      const demote = await call(alice, 'PATCH', `${members(alice)}/${alice.id}`, { role: 'admin' });
      expect(demote).toMatchObject({ status: 409, body: { code: 'PRIMARY_OWNER' } });
      expect((await call(alice, 'DELETE', `${members(alice)}/${alice.id}`)).body.code).toBe('PRIMARY_OWNER');
      expect((await call(alice, 'PATCH', `${members(alice)}/${alice.id}`, { status: 'suspended' })).status).toBe(400);
      expect((await call(bob, 'PATCH', `${members(bob)}/${alice.id}`, { status: 'suspended' })).body.code).toBe('PRIMARY_OWNER');
      expect((await call(bob, 'DELETE', `${members(bob)}/${alice.id}`)).body.code).toBe('PRIMARY_OWNER');
      expect(await roleOf(alice)).toBe('owner');

      // The last remaining owner who is not the primary one (say, after SCIM moved the primary
      // contact elsewhere) cannot be demoted or removed either.
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: alice.id }, { $set: { role: 'admin' } });
      await WorkspaceModel.updateOne({ _id: wsId }, { $set: { ownerId: dave.id } });
      for (const [method, body] of [
        ['PATCH', { role: 'editor' }],
        ['PATCH', { status: 'suspended' }],
        ['DELETE', undefined],
      ] as const) {
        const res = await call(bob, method, `${members(bob)}/${bob.id}`, body);
        expect(res.status).toBe(method === 'PATCH' && body && 'status' in body ? 400 : 409);
        if (res.status === 409) expect(res.body.code).toBe('LAST_OWNER');
      }
      expect(await roleOf(bob)).toBe('owner');
    });

    it('transfers ownership explicitly, to an active member, by the primary owner only', async () => {
      await addMember(bob, 'admin');
      await addMember(carol, 'viewer');
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: carol.id }, { $set: { status: 'suspended' } });

      expect((await call(bob, 'POST', `${members(bob)}/${bob.id}/transfer-ownership`)).body.code).toBe('NOT_PRIMARY_OWNER');
      expect((await call(alice, 'POST', `${members(alice)}/${alice.id}/transfer-ownership`)).status).toBe(400);
      expect((await call(alice, 'POST', `${members(alice)}/${carol.id}/transfer-ownership`)).status).toBe(400);
      expect((await call(alice, 'POST', `${members(alice)}/${dave.id}/transfer-ownership`)).body.code).toBe('MEMBER_NOT_FOUND');

      const done = await call(alice, 'POST', `${members(alice)}/${bob.id}/transfer-ownership`);
      expect(done.status).toBe(200);
      expect(String((await WorkspaceModel.findById(wsId))!.ownerId)).toBe(bob.id);
      expect(await roleOf(bob)).toBe('owner');

      // Alice is an ordinary owner now and may step down; Bob, the primary owner, may not.
      expect((await call(alice, 'PATCH', `${members(alice)}/${alice.id}`, { role: 'editor' })).status).toBe(200);
      expect((await call(bob, 'PATCH', `${members(bob)}/${bob.id}`, { role: 'editor' })).body.code).toBe('PRIMARY_OWNER');
      expect((await auditEvents({ action: 'workspace.owner.transfer' }))[0]).toMatchObject({ targetId: bob.id });
    });

    it('suspends and reactivates, and a suspended member loses the workspace at once', async () => {
      await addMember(bob, 'editor');
      const path = `${members(alice)}/${bob.id}`;
      expect((await call(alice, 'PATCH', path, { status: 'suspended' })).body.data.member.status).toBe('suspended');
      expect((await call(bob, 'GET', `/api/workspaces/${wsId}`)).status).toBe(403);
      expect((await call(bob, 'GET', '/api/presentations', undefined, wsId)).status).toBe(403);
      expect((await call(alice, 'PATCH', path, { status: 'active' })).body.data.member.status).toBe('active');
      expect((await call(bob, 'GET', `/api/workspaces/${wsId}`)).status).toBe(200);
      expect((await call(alice, 'PATCH', `${members(alice)}/${alice.id}`, { status: 'suspended' })).status).toBe(400);
    });

    it('reactivating a member needs a free seat', async () => {
      await WorkspaceModel.updateOne({ _id: wsId }, { $set: { planOverrides: { limits: { seats: 2 } } } });
      await addMember(bob, 'editor');
      await addMember(carol, 'viewer');
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: carol.id }, { $set: { status: 'suspended' } });
      const res = await call(alice, 'PATCH', `${members(alice)}/${carol.id}`, { status: 'active' });
      expect(res).toMatchObject({ status: 403, body: { code: 'PLAN_LIMIT_REACHED', details: { limit: 'seats', max: 2 } } });
    });

    it('removes a member with their shares; members can leave; the audit trail records both', async () => {
      await addMember(bob, 'viewer');
      await addMember(carol, 'editor');
      const deck = await createPresentation(server, { ...alice, headers: { ...alice.headers, 'x-workspace-id': wsId } as any });
      await ResourceShareModel.create({
        workspaceId: wsId,
        resourceType: 'presentation',
        resourceId: deck._id,
        principalType: 'user',
        principalId: bob.id,
        role: 'editor',
      });

      expect((await call(carol, 'DELETE', `${members(carol)}/${bob.id}`)).status).toBe(403);
      expect((await call(alice, 'DELETE', `${members(alice)}/${bob.id}`)).status).toBe(200);
      expect(await roleOf(bob)).toBeUndefined();
      expect(await ResourceShareModel.countDocuments({ principalId: bob.id })).toBe(0);
      expect((await call(bob, 'GET', `/api/workspaces/${wsId}`)).status).toBe(403);

      // Carol leaves on her own.
      expect((await call(carol, 'DELETE', `${members(carol)}/${carol.id}`)).status).toBe(200);
      expect(await roleOf(carol)).toBeUndefined();
      expect((await call(alice, 'DELETE', `${members(alice)}/${bob.id}`)).body.code).toBe('MEMBER_NOT_FOUND');

      expect((await auditEvents({ action: 'member.remove' }))[0]).toMatchObject({ targetId: bob.id, actorId: expect.anything() });
      expect((await auditEvents({ action: 'member.leave' }))[0]).toMatchObject({ targetId: carol.id });
    });
  });

  describe('invites', () => {
    const invitesPath = () => `/api/workspaces/${wsId}/invites`;
    const invite = (email: string, role = 'editor', user: TestUser = alice) => call(user, 'POST', invitesPath(), { email, role });
    const accept = (user: TestUser | null, token: string) => call(user, 'POST', `/api/invites/${token}/accept`);

    it('creates a hashed single-use invitation, returns the link once and audits it', async () => {
      const res = await invite('Bob@Example.com ', 'editor');
      expect(res.status).toBe(201);
      const { invite: created, inviteUrl, emailSent, refreshed } = res.body.data;
      expect(created).toMatchObject({ email: 'bob@example.com', role: 'editor', invitedBy: { id: alice.id, name: 'Alice' } });
      expect(emailSent).toBe(false); // no mail provider in tests
      expect(refreshed).toBe(false);
      const token = inviteToken(inviteUrl);
      expect(token.length).toBeGreaterThanOrEqual(40);

      const stored = await WorkspaceInviteModel.findOne({ workspaceId: wsId }).lean();
      expect(stored!.tokenHash).toBe(hashInviteToken(token));
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

      const events = await auditEvents({ action: 'invite.create' });
      expect(events[0]).toMatchObject({ targetType: 'invite', targetId: created.id, meta: { email: 'bob@example.com', role: 'editor' } });
      expect(JSON.stringify(events[0])).not.toContain(token);
      // The list never carries tokens or links.
      const list = await call(alice, 'GET', invitesPath());
      expect(list.body.data.invites).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(token);
    });

    it('needs workspace:members, a team workspace, a free seat and a valid body', async () => {
      await addMember(bob, 'editor');
      expect((await invite('x@example.com', 'viewer', bob)).status).toBe(403);
      expect((await call(dave, 'POST', invitesPath(), { email: 'x@example.com', role: 'viewer' })).body.code).toBe('WORKSPACE_FORBIDDEN');
      expect((await call(null, 'POST', invitesPath(), { email: 'x@example.com', role: 'viewer' })).status).toBe(401);

      for (const body of [
        { email: 'not-an-email', role: 'editor' },
        { email: 'x@example.com', role: 'owner' },
        { email: 'x@example.com', role: 'root' },
        { email: 'x@example.com' },
        { email: 'x@example.com', role: 'editor', workspaceId: wsId },
      ]) {
        expect((await call(alice, 'POST', invitesPath(), body)).status).toBe(400);
      }

      // Personal workspaces have no other members.
      const personal = (await call(alice, 'GET', '/api/workspaces')).body.data.workspaces.find((w: any) => w.type === 'personal');
      const inPersonal = await call(alice, 'POST', `/api/workspaces/${personal._id}/invites`, { email: 'x@example.com', role: 'viewer' });
      expect(inPersonal).toMatchObject({ status: 403, body: { code: 'PERSONAL_WORKSPACE' } });

      // Seats: Alice and Bob use 2 of 5; three more invitations fill the plan, the fourth does not fit.
      await WorkspaceModel.updateOne({ _id: wsId }, { $set: { planOverrides: { limits: { seats: 4 } } } });
      expect((await invite('a@example.com')).status).toBe(201);
      expect((await invite('b@example.com')).status).toBe(201);
      const full = await invite('c@example.com');
      expect(full).toMatchObject({ status: 403, body: { code: 'PLAN_LIMIT_REACHED', details: { limit: 'seats', max: 4 } } });
      // Re-inviting an address that already holds a pending invite needs no extra seat.
      expect((await invite('a@example.com', 'viewer')).status).toBe(201);
    });

    it('lets admins invite up to their own rank only', async () => {
      await addMember(bob, 'admin');
      expect((await invite('x@example.com', 'admin', bob)).status).toBe(201);
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: bob.id }, { $set: { role: 'editor' } });
      expect((await invite('y@example.com', 'viewer', bob)).status).toBe(403);
    });

    it('is duplicate-safe: one pending invite per address, a re-invite replaces the link', async () => {
      const first = await invite(bob.email, 'viewer');
      const second = await invite(bob.email, 'editor');
      expect(second.status).toBe(201);
      expect(second.body.data.refreshed).toBe(true);
      expect(second.body.data.invite.id).toBe(first.body.data.invite.id);
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId })).toBe(1);

      // The first link is dead, the second one works and carries the new role.
      expect((await accept(bob, inviteToken(first.body.data.inviteUrl))).body.code).toBe('INVITE_INVALID');
      const accepted = await accept(bob, inviteToken(second.body.data.inviteUrl));
      expect(accepted.status).toBe(200);
      expect(accepted.body.data.membership).toEqual({ role: 'editor', status: 'active' });

      // Simultaneous first invites for one address end up as one document.
      const results = await Promise.all(Array.from({ length: 5 }, () => invite('race@example.com')));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId, email: 'race@example.com' })).toBe(1);
    });

    it('rate-limits invitations per address', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await invite('spam@example.com')).status);
      expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });

    it('refuses addresses that already belong to the workspace', async () => {
      await addMember(bob, 'viewer');
      const res = await invite(bob.email);
      expect(res).toMatchObject({ status: 409, body: { code: 'ALREADY_MEMBER' } });
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: bob.id }, { $set: { status: 'suspended' } });
      expect((await invite(bob.email)).body).toMatchObject({ code: 'ALREADY_MEMBER', details: { status: 'suspended' } });
    });

    it('accepts once, for the invited verified email, and takes a seat', async () => {
      const token = inviteToken((await invite(bob.email, 'presenter')).body.data.inviteUrl);

      expect((await accept(null, token)).status).toBe(401);
      const wrong = await accept(carol, token);
      expect(wrong).toMatchObject({ status: 403, body: { code: 'INVITE_EMAIL_MISMATCH' } });
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId })).toBe(1); // not consumed

      const ok = await accept(bob, token);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({
        workspace: { _id: wsId, name: 'Acme', type: 'team' },
        membership: { role: 'presenter', status: 'active' },
        alreadyMember: false,
      });
      expect(await roleOf(bob)).toBe('presenter');
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId })).toBe(0);
      expect((await call(bob, 'GET', `/api/workspaces/${wsId}`)).body.data.membership.role).toBe('presenter');

      expect((await accept(bob, token)).body.code).toBe('INVITE_INVALID'); // single use
      expect((await auditEvents({ action: 'invite.accept' }))[0]).toMatchObject({ actorId: expect.anything(), meta: { role: 'presenter' } });
    });

    it('matches the email case-insensitively and refuses unverified accounts', async () => {
      const mixed = await createVerifiedUser({ email: 'Mixed.Case@Example.com' });
      const token = inviteToken((await invite('mixed.case@example.com')).body.data.inviteUrl);
      expect((await accept(mixed, token)).status).toBe(200);

      const unverified = await UserModel.create({ email: 'unverified@example.com', name: 'Una', password: 'Correct-Horse-9', isVerified: false });
      const { generateAccessToken } = await import('../../src/common/utils/jwt.utils');
      const una: TestUser = {
        id: String(unverified._id),
        email: unverified.email,
        name: 'Una',
        password: '',
        accessToken: '',
        headers: { authorization: `Bearer ${generateAccessToken({ id: unverified._id, email: unverified.email, name: 'Una', role: 'user' })}` },
      };
      const second = inviteToken((await invite(una.email)).body.data.inviteUrl);
      expect((await accept(una, second)).body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId, email: una.email })).toBe(1);
    });

    it('lets exactly one of many simultaneous accepts win', async () => {
      const token = inviteToken((await invite(bob.email)).body.data.inviteUrl);
      const results = await Promise.all(Array.from({ length: 6 }, () => accept(bob, token)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 404)).toHaveLength(5);
      expect(await WorkspaceMemberModel.countDocuments({ workspaceId: wsId, userId: bob.id })).toBe(1);
    });

    it('rejects expired, revoked and unknown tokens', async () => {
      const token = inviteToken((await invite(bob.email)).body.data.inviteUrl);
      await WorkspaceInviteModel.updateOne({ workspaceId: wsId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await accept(bob, token)).body.code).toBe('INVITE_INVALID');
      expect((await call(null, 'GET', `/api/invites/${token}`)).status).toBe(404);
      expect((await call(alice, 'GET', invitesPath())).body.data.invites).toHaveLength(0);

      const fresh = (await invite(bob.email)).body.data;
      expect((await call(alice, 'DELETE', `${invitesPath()}/${fresh.invite.id}`)).status).toBe(200);
      expect((await accept(bob, inviteToken(fresh.inviteUrl))).body.code).toBe('INVITE_INVALID');
      expect((await call(alice, 'DELETE', `${invitesPath()}/${fresh.invite.id}`)).body.code).toBe('INVITE_NOT_FOUND');
      expect((await accept(bob, 'x'.repeat(43))).status).toBe(404);
      expect((await accept(bob, 'short')).status).toBe(404);
      expect((await auditEvents({ action: 'invite.revoke' }))[0]).toMatchObject({ targetId: fresh.invite.id });
    });

    it('only the workspace revokes its own invitations', async () => {
      const created = (await invite(bob.email)).body.data.invite;
      const other = (await call(carol, 'POST', '/api/workspaces', { name: 'Other' })).body.data.workspace._id;
      const res = await call(carol, 'DELETE', `/api/workspaces/${other}/invites/${created.id}`);
      expect(res.body.code).toBe('INVITE_NOT_FOUND');
      expect((await call(carol, 'DELETE', `${invitesPath()}/${created.id}`)).body.code).toBe('WORKSPACE_FORBIDDEN');
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId })).toBe(1);
      await addMember(dave, 'editor');
      expect((await call(dave, 'GET', invitesPath())).status).toBe(403);
      expect((await call(dave, 'DELETE', `${invitesPath()}/${created.id}`)).status).toBe(403);
    });

    it('checks seats again at accept and leaves the invite in place when full', async () => {
      const token = inviteToken((await invite(bob.email)).body.data.inviteUrl);
      await WorkspaceModel.updateOne({ _id: wsId }, { $set: { planOverrides: { limits: { seats: 1 } } } });
      const res = await accept(bob, token);
      expect(res).toMatchObject({ status: 403, body: { code: 'PLAN_LIMIT_REACHED' } });
      expect(await WorkspaceInviteModel.countDocuments({ workspaceId: wsId })).toBe(1);
      expect(await roleOf(bob)).toBeUndefined();
    });

    it('does not let a suspended member rejoin, and leaves current members unchanged', async () => {
      await addMember(bob, 'admin');
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: bob.id }, { $set: { status: 'suspended' } });
      const planted = 'p'.repeat(43);
      await WorkspaceInviteModel.create({
        workspaceId: wsId,
        email: bob.email,
        role: 'viewer',
        tokenHash: hashInviteToken(planted),
        expiresAt: new Date(Date.now() + 3600_000),
      });
      expect((await accept(bob, planted)).body.code).toBe('MEMBER_SUSPENDED');

      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: bob.id }, { $set: { status: 'active' } });
      const res = await accept(bob, planted);
      expect(res.body.data).toMatchObject({ alreadyMember: true, membership: { role: 'admin' } });
      expect(await roleOf(bob)).toBe('admin');
    });

    it('previews an invite without authentication and with the address masked', async () => {
      const token = inviteToken((await invite('someone@example.com', 'viewer')).body.data.inviteUrl);
      const preview = await call(null, 'GET', `/api/invites/${token}`);
      expect(preview.status).toBe(200);
      expect(preview.body.data).toMatchObject({ workspaceName: 'Acme', role: 'viewer', inviterName: 'Alice', email: 's******@example.com' });
      expect(JSON.stringify(preview.body)).not.toContain('someone@');
      expect((await call(null, 'GET', `/api/invites/${'z'.repeat(43)}`)).status).toBe(404);
    });

    it('stops working when the workspace is deleted', async () => {
      const token = inviteToken((await invite(bob.email)).body.data.inviteUrl);
      await WorkspaceModel.updateOne({ _id: wsId }, { $set: { deletedAt: new Date() } });
      expect((await accept(bob, token)).body.code).toBe('INVITE_INVALID');
    });
  });

  describe('resource shares', () => {
    let deck: any;
    let asAlice: TestUser;
    const sharesPath = (id: string, type = 'presentation') => `/api/shares?resourceType=${type}&resourceId=${id}`;
    const putShares = (user: TestUser, id: string, shares: unknown[], type = 'presentation', workspace = wsId) =>
      call(user, 'PUT', sharesPath(id, type), { shares }, workspace);

    beforeEach(async () => {
      await addMember(bob, 'viewer');
      await addMember(carol, 'presenter');
      asAlice = { ...alice, headers: { ...alice.headers, 'x-workspace-id': wsId } as any };
      deck = await createPresentation(server, asAlice);
    });

    it('raises a viewer to editor on one deck, never beyond, and never elsewhere', async () => {
      const other = await createPresentation(server, asAlice, { title: 'Other deck' });
      expect((await call(bob, 'PATCH', `/api/presentations/${deck._id}`, { title: 'Hacked' }, wsId)).status).toBe(403);

      const put = await putShares(alice, deck._id, [{ principalType: 'user', principalId: bob.id, role: 'editor' }]);
      expect(put.status).toBe(200);
      expect(put.body.data.shares).toEqual([
        expect.objectContaining({ principalType: 'user', principalId: bob.id, role: 'editor', name: 'Bob', workspaceRole: 'viewer' }),
      ]);
      expect(put.body.data.resource).toMatchObject({ type: 'presentation', id: deck._id, title: 'Integration deck' });

      expect((await call(bob, 'PATCH', `/api/presentations/${deck._id}`, { title: 'Edited by Bob' }, wsId)).status).toBe(200);
      expect((await call(bob, 'PATCH', `/api/presentations/${other._id}`, { title: 'Nope' }, wsId)).status).toBe(403);
      // Structural actions stay with the workspace role: no delete, no re-sharing.
      expect((await call(bob, 'DELETE', `/api/presentations/${deck._id}`, undefined, wsId)).status).toBe(403);
      expect((await putShares(bob, deck._id, [{ principalType: 'user', principalId: carol.id, role: 'viewer' }])).status).toBe(403);
      expect((await call(bob, 'GET', sharesPath(deck._id), undefined, wsId)).status).toBe(403);

      expect((await auditEvents({ action: 'share.grant' }))[0]).toMatchObject({
        targetType: 'presentation',
        targetId: deck._id,
        meta: { principalId: bob.id, role: 'editor', previousRole: null },
      });
    });

    it('applies diffs: updates roles, revokes what is missing and keeps what is unchanged', async () => {
      await putShares(alice, deck._id, [
        { principalType: 'user', principalId: bob.id, role: 'viewer' },
        { principalType: 'user', principalId: carol.id, role: 'editor' },
      ]);
      const before = await ResourceShareModel.findOne({ principalId: carol.id }).lean();
      const res = await putShares(alice, deck._id, [{ principalType: 'user', principalId: bob.id, role: 'presenter' }]);
      expect(res.body.data.shares.map((s: any) => [s.name, s.role])).toEqual([['Bob', 'presenter']]);
      expect(await ResourceShareModel.countDocuments({ principalId: carol.id })).toBe(0);
      expect(before).not.toBeNull();
      expect((await auditEvents({ action: 'share.update' }))[0]).toMatchObject({ meta: { principalId: bob.id, role: 'presenter', previousRole: 'viewer' } });
      expect((await auditEvents({ action: 'share.revoke' }))[0]).toMatchObject({ meta: { principalId: carol.id, previousRole: 'editor' } });

      // A no-op PUT writes nothing.
      const events = await AuditEventModel.countDocuments({ workspaceId: wsId, action: /^share\./ });
      await putShares(alice, deck._id, [{ principalType: 'user', principalId: bob.id, role: 'presenter' }]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await AuditEventModel.countDocuments({ workspaceId: wsId, action: /^share\./ })).toBe(events);

      const emptied = await putShares(alice, deck._id, []);
      expect(emptied.body.data.shares).toEqual([]);
      expect(await ResourceShareModel.countDocuments({})).toBe(0);
    });

    it('lets a presenter share host the deck but not edit it', async () => {
      const hostState = `/api/presentations/${deck._id}/host/state`;
      expect((await call(bob, 'GET', hostState, undefined, wsId)).status).toBe(403);
      await putShares(alice, deck._id, [{ principalType: 'user', principalId: bob.id, role: 'presenter' }]);
      expect((await call(bob, 'GET', hostState, undefined, wsId)).status).toBe(200);
      expect((await call(bob, 'PATCH', `/api/presentations/${deck._id}`, { title: 'x' }, wsId)).status).toBe(403);
    });

    it('shares with groups and through folders', async () => {
      const group = await WorkspaceGroupModel.create({ workspaceId: wsId, displayName: 'Trainers', memberIds: [bob.id] });
      const folderId = new mongoose.Types.ObjectId();
      await mongoose.connection.collection('folders').insertOne({ _id: folderId, workspaceId: new mongoose.Types.ObjectId(wsId), name: 'Q3' });
      await PresentationModel.updateOne({ _id: deck._id }, { $set: { folderId } });

      const viaGroup = await putShares(alice, deck._id, [{ principalType: 'group', principalId: String(group._id), role: 'editor' }]);
      expect(viaGroup.body.data.shares).toEqual([expect.objectContaining({ principalType: 'group', name: 'Trainers', email: null })]);
      expect(viaGroup.body.data.groups).toEqual([{ id: String(group._id), name: 'Trainers', memberCount: 1 }]);
      expect((await call(bob, 'PATCH', `/api/presentations/${deck._id}`, { title: 'Via group' }, wsId)).status).toBe(200);
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { title: 'No' }, wsId)).status).toBe(403);
      await putShares(alice, deck._id, []);

      const viaFolder = await putShares(alice, String(folderId), [{ principalType: 'user', principalId: carol.id, role: 'editor' }], 'folder');
      expect(viaFolder.status).toBe(200);
      expect(viaFolder.body.data.resource).toMatchObject({ type: 'folder', title: 'Q3' });
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { title: 'Via folder' }, wsId)).status).toBe(200);
      await PresentationModel.updateOne({ _id: deck._id }, { $set: { folderId: null } });
      expect((await call(carol, 'PATCH', `/api/presentations/${deck._id}`, { title: 'No longer' }, wsId)).status).toBe(403);

      expect((await putShares(alice, String(new mongoose.Types.ObjectId()), [], 'folder')).status).toBe(404);
    });

    it('only shares inside the workspace: outsiders, other workspaces and bad bodies are refused', async () => {
      const outsider = await putShares(alice, deck._id, [{ principalType: 'user', principalId: dave.id, role: 'viewer' }]);
      expect(outsider).toMatchObject({ status: 400, body: { code: 'PRINCIPAL_NOT_IN_WORKSPACE', details: { principalIds: [dave.id] } } });
      const foreignGroup = await WorkspaceGroupModel.create({ workspaceId: new mongoose.Types.ObjectId(), displayName: 'Foreign', memberIds: [bob.id] });
      expect((await putShares(alice, deck._id, [{ principalType: 'group', principalId: String(foreignGroup._id), role: 'viewer' }])).status).toBe(400);
      await WorkspaceMemberModel.updateOne({ workspaceId: wsId, userId: bob.id }, { $set: { status: 'suspended' } });
      expect((await putShares(alice, deck._id, [{ principalType: 'user', principalId: bob.id, role: 'viewer' }])).status).toBe(400);

      for (const shares of [
        [{ principalType: 'user', principalId: carol.id, role: 'owner' }],
        [{ principalType: 'user', principalId: carol.id, role: 'admin' }],
        [{ principalType: 'user', principalId: 'nope', role: 'viewer' }],
        [{ principalType: 'team', principalId: carol.id, role: 'viewer' }],
        [
          { principalType: 'user', principalId: carol.id, role: 'viewer' },
          { principalType: 'user', principalId: carol.id, role: 'editor' },
        ],
      ]) {
        expect((await putShares(alice, deck._id, shares)).status).toBe(400);
      }
      expect((await call(alice, 'PUT', sharesPath(deck._id), {}, wsId)).status).toBe(400);
      expect((await call(alice, 'GET', '/api/shares?resourceType=poll&resourceId=' + deck._id, undefined, wsId)).status).toBe(400);
      expect((await call(alice, 'GET', '/api/shares?resourceType=presentation&resourceId=zzz', undefined, wsId)).status).toBe(400);
      expect(await ResourceShareModel.countDocuments({})).toBe(0);

      // Another workspace: Dave owns his own team and cannot see or change shares on Acme's deck.
      const daveTeam = (await call(dave, 'POST', '/api/workspaces', { name: 'Daves' })).body.data.workspace._id;
      expect((await call(dave, 'GET', sharesPath(deck._id), undefined, daveTeam)).status).toBe(403);
      expect((await putShares(dave, deck._id, [], 'presentation', daveTeam)).status).toBe(403);
      expect((await call(dave, 'GET', sharesPath(deck._id), undefined, wsId)).body.code).toBe('WORKSPACE_FORBIDDEN');
    });

    it('a grant for someone outside the workspace is inert, even if written by hand', async () => {
      await ResourceShareModel.create({
        workspaceId: wsId,
        resourceType: 'presentation',
        resourceId: deck._id,
        principalType: 'user',
        principalId: dave.id,
        role: 'editor',
      });
      expect((await call(dave, 'GET', `/api/presentations/${deck._id}`)).status).toBe(403);
      expect((await call(dave, 'GET', `/api/presentations/${deck._id}`, undefined, wsId)).status).toBe(403);
      expect((await call(dave, 'PATCH', `/api/presentations/${deck._id}`, { title: 'x' }, wsId)).status).toBe(403);
    });

    it('cleans up with the deck, and cannot share decks that predate workspaces', async () => {
      await putShares(alice, deck._id, [{ principalType: 'user', principalId: bob.id, role: 'viewer' }]);
      expect((await call(alice, 'DELETE', `/api/presentations/${deck._id}`, undefined, wsId)).status).toBe(200);
      expect(await ResourceShareModel.countDocuments({})).toBe(0);

      const legacy = await createPresentation(server, asAlice);
      await PresentationModel.collection.updateOne({ _id: new mongoose.Types.ObjectId(legacy._id) }, { $unset: { workspaceId: '' } });
      const res = await call(alice, 'GET', sharesPath(legacy._id), undefined, wsId);
      expect(res).toMatchObject({ status: 409, body: { code: 'NOT_SHAREABLE' } });
    });
  });

  describe('audit log', () => {
    const seed = async () => {
      await addMember(bob, 'editor');
      await addMember(carol, 'viewer');
      await call(alice, 'PATCH', `${members(alice)}/${bob.id}`, { role: 'admin' });
      await call(alice, 'PATCH', `${members(alice)}/${carol.id}`, { role: 'presenter' });
      await call(bob, 'POST', `/api/workspaces/${wsId}/invites`, { email: 'new@example.com', role: 'viewer' });
      await auditEvents({}, 4); // + workspace.create
    };

    it('lists the workspace events newest first with actors, filters and pagination', async () => {
      await seed();
      const all = await call(alice, 'GET', '/api/audit', undefined, wsId);
      expect(all.status).toBe(200);
      const { events, actions, nextCursor } = all.body.data;
      expect(nextCursor).toBeNull();
      expect(events.map((e: any) => e.action)).toEqual(['invite.create', 'member.role.update', 'member.role.update', 'workspace.create']);
      expect(events[0]).toMatchObject({ actor: { id: bob.id, name: 'Bob', email: bob.email }, actorType: 'user', targetType: 'invite' });
      expect(events[1]).toMatchObject({ targetId: carol.id, meta: { from: 'viewer', to: 'presenter' } });
      expect(actions).toEqual(['invite.create', 'member.role.update', 'workspace.create']);

      const byAction = await call(alice, 'GET', '/api/audit?action=member.role.update', undefined, wsId);
      expect(byAction.body.data.events).toHaveLength(2);
      const byPrefix = await call(alice, 'GET', '/api/audit?action=member.*', undefined, wsId);
      expect(byPrefix.body.data.events).toHaveLength(2);
      expect((await call(alice, 'GET', '/api/audit?action=invite.*', undefined, wsId)).body.data.events).toHaveLength(1);
      const byActor = await call(alice, 'GET', `/api/audit?actor=${bob.id}`, undefined, wsId);
      expect(byActor.body.data.events.map((e: any) => e.action)).toEqual(['invite.create']);
      expect((await call(alice, 'GET', `/api/audit?actor=${bob.id}&action=member.*`, undefined, wsId)).body.data.events).toEqual([]);

      const page1 = await call(alice, 'GET', '/api/audit?limit=2', undefined, wsId);
      expect(page1.body.data.events).toHaveLength(2);
      expect(page1.body.data.nextCursor).toEqual(expect.any(String));
      const page2 = await call(alice, 'GET', `/api/audit?limit=2&cursor=${page1.body.data.nextCursor}`, undefined, wsId);
      expect(page2.body.data.events).toHaveLength(2);
      expect(page2.body.data.nextCursor).toBeNull();
      expect(page2.body.data.actions).toEqual([]);
      expect([...page1.body.data.events, ...page2.body.data.events].map((e: any) => e.id)).toEqual(events.map((e: any) => e.id));
    });

    it('needs workspace:manage, ignores other workspaces and rejects bad queries', async () => {
      await seed();
      expect((await call(carol, 'GET', '/api/audit', undefined, wsId)).status).toBe(403);
      expect((await call(null, 'GET', '/api/audit')).status).toBe(401);
      expect((await call(bob, 'GET', '/api/audit', undefined, wsId)).status).toBe(200); // admin
      expect((await call(dave, 'GET', '/api/audit', undefined, wsId)).body.code).toBe('WORKSPACE_FORBIDDEN');

      // Dave's own workspace shows none of Acme's events.
      const own = await call(dave, 'GET', '/api/audit');
      expect(own.status).toBe(200);
      expect(own.body.data.events).toEqual([]);

      for (const query of ['limit=0', 'limit=1000', 'cursor=garbage', 'actor=nope', 'action=a%20b', 'action=.*(']) {
        expect((await call(alice, 'GET', `/api/audit?${query}`, undefined, wsId)).status).toBe(400);
      }
    });
  });

  describe('migration 100', () => {
    it('keeps the newest of duplicate invites and makes the address index unique', async () => {
      const collection = WorkspaceInviteModel.collection;
      await collection.dropIndex('workspaceId_1_email_1').catch(() => undefined);
      const workspaceId = new mongoose.Types.ObjectId();
      const base = { workspaceId, email: 'dup@example.com', role: 'viewer', expiresAt: new Date(Date.now() + 3600_000), createdAt: new Date() };
      await collection.insertMany([
        { ...base, tokenHash: 'a'.repeat(64), updatedAt: new Date(1000) },
        { ...base, tokenHash: 'b'.repeat(64), updatedAt: new Date(3000) },
        { ...base, tokenHash: 'c'.repeat(64), updatedAt: new Date(2000) },
      ] as never[]);

      const logs: string[] = [];
      const context = { db: mongoose.connection.db!, connection: mongoose.connection, log: (m: string) => logs.push(m) };
      await migration100.up(context);
      expect((await collection.find({ workspaceId }).toArray()).map((doc) => doc.tokenHash)).toEqual(['b'.repeat(64)]);
      expect(logs.join('\n')).toContain('removed 2 duplicate');

      await expect(collection.insertOne({ ...base, tokenHash: 'd'.repeat(64) } as never)).rejects.toThrow(/duplicate key/);
      await migration100.up(context); // idempotent
      expect(await collection.countDocuments({ workspaceId })).toBe(1);
    });
  });
});
