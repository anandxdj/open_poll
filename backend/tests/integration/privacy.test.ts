import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import mongoose from 'mongoose';
import type { WorkspaceRole } from '../../src/common/tenancy/roles';
import { generateAccessToken } from '../../src/common/utils/jwt.utils';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { UserModel } from '../../src/modules/auth/auth.model';
import { McpTokenModel } from '../../src/modules/mcp/mcp.token.model';
import { McpGrantModel } from '../../src/modules/mcp/oauth/oauth.grant.model';
import { PollModel } from '../../src/modules/polls/polls.model';
import {
  PresentationAnswerModel,
  PresentationModel,
  PresentationParticipantModel,
  PresentationSessionModel,
} from '../../src/modules/presentations/presentations.model';
import { DataExportJobModel } from '../../src/modules/privacy/privacy.model';
import { DELETED_USER_NAME, runAccountPurge, runRetentionPurge } from '../../src/modules/privacy/privacy.purge';
import { ResponseModel } from '../../src/modules/responses/responses.model';
import { REMOVED_PARTICIPANT_NAME } from '../../src/modules/sessions/sessions.service';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/** W4-C: data export, re-auth, account deletion and purge, retention and participant self-removal over HTTP. */

type Body<T = any> = { success: boolean; message: string; code?: string; details?: any; data: T };

const DAY = 24 * 60 * 60 * 1000;

const connectedApp = (userId: string, hashSeed: string) => ({
  userId,
  workspaceId: new mongoose.Types.ObjectId(),
  clientId: 'client-1',
  clientName: 'Claude',
  scopes: ['deck:read'],
  accessTokenHash: `${hashSeed}-access`,
  accessExpiresAt: new Date(Date.now() + 3600_000),
  refreshTokenHash: `${hashSeed}-refresh`,
  refreshExpiresAt: new Date(Date.now() + 86400_000),
});

describeIntegration('privacy over HTTP', () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  const api = async <T = any>(method: string, path: string, user: TestUser | null = alice, body?: unknown) => {
    const res = await server.request(path, { method, headers: user ? user.headers : {}, body });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  /** A token minted as if the user signed in `agoMs` ago (DELETE /api/me takes a sign-in under 5 minutes old). */
  const freshSignIn = (user: TestUser, agoMs = 0): TestUser => {
    const authTime = Math.floor((Date.now() - agoMs) / 1000);
    const accessToken = generateAccessToken({ id: user.id, email: user.email, name: user.name, role: 'user', authTime });
    return { ...user, accessToken, headers: { authorization: `Bearer ${accessToken}` } };
  };

  const personalWorkspace = async (user: TestUser) =>
    (await WorkspaceModel.findOne({ ownerId: user.id, type: 'personal' }).lean())!;

  const teamWorkspace = async (owner: TestUser, members: { user: TestUser; role: WorkspaceRole }[]) => {
    const workspace = await WorkspaceModel.create({
      name: 'Design team',
      slug: `design-${new mongoose.Types.ObjectId()}`,
      type: 'team',
      ownerId: owner.id,
    });
    await WorkspaceMemberModel.create([
      { workspaceId: workspace._id, userId: owner.id, role: 'owner' },
      ...members.map(({ user, role }) => ({ workspaceId: workspace._id, userId: user.id, role })),
    ]);
    return workspace;
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice Example' });
    bob = await createVerifiedUser({ name: 'Bob Example' });
    // The first workspace-scoped request provisions the personal workspace.
    await api('GET', '/api/presentations', alice);
    await api('GET', '/api/presentations', bob);
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  describe('status and export', () => {
    it('needs a signed-in user', async () => {
      expect((await api('GET', '/api/me/privacy', null)).status).toBe(401);
      expect((await api('POST', '/api/me/export', null)).status).toBe(401);
      expect((await api('POST', '/api/me/reauth', null, { password: 'x' })).status).toBe(401);
      expect((await api('DELETE', '/api/me', null)).status).toBe(401);
    });

    it('reports the re-auth window, blockers and exports left', async () => {
      const status = (await api('GET', '/api/me/privacy')).body.data;
      expect(status).toMatchObject({
        hasPassword: true,
        reauthUntil: null,
        deletionGraceDays: 30,
        workspaces: { deleted: [expect.objectContaining({ name: expect.any(String) })], left: [] },
        blockers: { soleOwner: [], subscriptions: [] },
        exports: [],
        exportsLeftToday: 3,
      });
      const fresh = (await api('GET', '/api/me/privacy', freshSignIn(alice))).body.data;
      expect(Date.parse(fresh.reauthUntil)).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    });

    it('exports the user’s own data as a zip, without secrets or other people’s content', async () => {
      await createPoll(server, alice, { title: 'Alice lunch poll' });
      await createPresentation(server, alice, { title: 'Alice kickoff deck' });
      await createPoll(server, bob, { title: 'Bob secret poll' });
      await McpTokenModel.create({ userId: alice.id, tokenHash: 'hash-never-exported', prefix: 'op_mcp', last4: 'abcd', label: 'Laptop', scopes: [] });
      await McpGrantModel.create(connectedApp(alice.id, 'grant-hash-never-exported'));

      const res = await server.request('/api/me/export', { method: 'POST', headers: alice.headers });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="openpoll-data-\d{4}-\d{2}-\d{2}\.zip"$/);
      const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
      expect(Object.keys(files).sort()).toEqual([
        'README.txt',
        'activity.json',
        'exports.json',
        'imports.json',
        'mcp-connected-apps.json',
        'mcp-tokens.json',
        'poll-responses.json',
        'polls.json',
        'presentations.json',
        'profile.json',
        'sessions-hosted.json',
        'uploads.json',
        'workspaces.json',
      ]);
      const read = (name: string) => JSON.parse(strFromU8(files[name]!));
      expect(read('profile.json')).toMatchObject({ email: alice.email, name: 'Alice Example', hasPassword: true });
      expect(read('polls.json').map((p: { title: string }) => p.title)).toEqual(['Alice lunch poll']);
      expect(read('presentations.json').map((p: { title: string }) => p.title)).toEqual(['Alice kickoff deck']);
      expect(read('workspaces.json')).toEqual([expect.objectContaining({ type: 'personal', role: 'owner' })]);
      expect(read('mcp-tokens.json')).toEqual([expect.objectContaining({ label: 'Laptop', last4: 'abcd' })]);
      expect(read('mcp-connected-apps.json')).toEqual([expect.objectContaining({ clientName: 'Claude', scopes: ['deck:read'] })]);
      const everything = Object.values(files).map((bytes) => strFromU8(bytes)).join('\n');
      expect(everything).not.toContain('Bob secret poll');
      expect(everything).not.toContain('hash-never-exported');
      expect(everything).not.toContain('grant-hash-never-exported');
      expect(everything).not.toContain('$2'); // no bcrypt hash

      expect(await DataExportJobModel.countDocuments({ userId: alice.id, status: 'delivered' })).toBe(1);
      expect(await AuditEventModel.countDocuments({ action: 'account.export', actorId: alice.id })).toBe(1);
    });

    it('allows three exports a day', async () => {
      for (let i = 0; i < 3; i += 1) {
        expect((await server.request('/api/me/export', { method: 'POST', headers: alice.headers })).status).toBe(200);
      }
      const fourth = await api('POST', '/api/me/export');
      expect([fourth.status, fourth.body.code]).toEqual([429, 'EXPORT_LIMIT']);
      expect((await api('GET', '/api/me/privacy')).body.data.exportsLeftToday).toBe(0);
    });
  });

  describe('account deletion', () => {
    it('needs a fresh sign-in or the password', async () => {
      const stale = await api('DELETE', '/api/me', freshSignIn(alice, 10 * 60 * 1000));
      expect([stale.status, stale.body.code]).toEqual([403, 'REAUTH_REQUIRED']);

      const wrong = await api('POST', '/api/me/reauth', alice, { password: 'not-it' });
      expect([wrong.status, wrong.body.code]).toEqual([400, 'WRONG_PASSWORD']);
      const right = await api('POST', '/api/me/reauth', alice, { password: alice.password });
      expect(right.status).toBe(200);
      expect(Date.parse(right.body.data.reauthUntil)).toBeGreaterThan(Date.now() + 4 * 60 * 1000);

      expect((await api('DELETE', '/api/me')).status).toBe(200);
    });

    it('refuses while the user is the only owner of a team with other members', async () => {
      await teamWorkspace(alice, [{ user: bob, role: 'editor' }]);
      const status = (await api('GET', '/api/me/privacy')).body.data;
      expect(status.workspaces.left).toEqual([expect.objectContaining({ name: 'Design team' })]);
      const res = await api('DELETE', '/api/me', freshSignIn(alice));
      expect([res.status, res.body.code]).toEqual([409, 'SOLE_OWNER']);
      expect(res.body.details.workspaces).toEqual([expect.objectContaining({ name: 'Design team' })]);
      expect((await UserModel.findById(alice.id).lean())!.deletionRequestedAt).toBeNull();

      // A second owner lifts the block.
      await WorkspaceMemberModel.updateOne({ userId: bob.id, role: 'editor' }, { $set: { role: 'owner' } });
      expect((await api('DELETE', '/api/me', freshSignIn(alice))).status).toBe(200);
    });

    it('refuses while a workspace deleted with the account still pays', async () => {
      const personal = await personalWorkspace(alice);
      await WorkspaceModel.updateOne({ _id: personal._id }, { $set: { plan: 'pro', planSource: 'stripe', 'billing.status': 'active' } });
      const res = await api('DELETE', '/api/me', freshSignIn(alice));
      expect([res.status, res.body.code]).toEqual([409, 'ACTIVE_SUBSCRIPTION']);
      await WorkspaceModel.updateOne({ _id: personal._id }, { $set: { 'billing.cancelAtPeriodEnd': true } });
      expect((await api('DELETE', '/api/me', freshSignIn(alice))).status).toBe(200);
    });

    it('signs the account out everywhere until its owner signs in again, which cancels the deletion', async () => {
      await McpTokenModel.create({ userId: alice.id, tokenHash: 'mcp-hash', prefix: 'op_mcp', last4: 'wxyz', label: 'CLI', scopes: [] });
      await McpGrantModel.create(connectedApp(alice.id, 'grant-hash'));
      const fresh = freshSignIn(alice);
      const res = await api('DELETE', '/api/me', fresh);
      expect(res.status).toBe(200);
      expect(Date.parse(res.body.data.purgeAt) - Date.now()).toBeGreaterThan(29.9 * DAY);
      expect((await api('GET', '/api/auth/me', fresh)).status).toBe(401);
      expect(await McpTokenModel.countDocuments({ userId: alice.id })).toBe(0);
      expect(await McpGrantModel.countDocuments({ userId: alice.id })).toBe(0);
      const stored = await UserModel.findById(alice.id).select('+refreshToken').lean();
      expect(stored!.deletionRequestedAt).toBeInstanceOf(Date);
      expect(stored!.refreshToken).toBeUndefined();
      expect(await AuditEventModel.countDocuments({ action: 'account.deletion_request', actorId: alice.id })).toBe(1);

      const login = await api('POST', '/api/auth/login', null, { email: alice.email, password: alice.password });
      expect(login.status).toBe(200);
      expect(login.body.data.restored).toBe(true);
      expect((await UserModel.findById(alice.id).lean())!.deletionRequestedAt).toBeNull();
      const again = { ...alice, headers: { authorization: `Bearer ${login.body.data.accessToken}` } };
      expect((await api('GET', '/api/auth/me', again)).status).toBe(200);
    });
  });

  describe('purge', () => {
    it('deletes the account and its own workspaces after 30 days and leaves shared content credited to a deleted user', async () => {
      const poll = await createPoll(server, alice, { title: 'Personal poll' });
      await createPresentation(server, alice, { title: 'Personal deck' });
      const personal = await personalWorkspace(alice);
      const team = await teamWorkspace(bob, [{ user: alice, role: 'editor' }]);
      // A deck Alice made in the team (moved there directly; the API would need the team's context).
      const teamDeck = await createPresentation(server, alice, { title: 'Team deck' });
      await PresentationModel.updateOne({ _id: teamDeck._id }, { $set: { workspaceId: team._id } });
      const bobPoll = await createPoll(server, bob, { title: 'Bob poll' });
      await ResponseModel.create({ pollId: bobPoll._id, respondentId: alice.id, answers: [] });
      await AuditEventModel.create({ actorId: alice.id, actorType: 'user', action: 'poll.create', ip: '203.0.113.9', ua: 'Firefox' });
      await UserModel.updateOne({ _id: alice.id }, { $set: { deletionRequestedAt: new Date(Date.now() - 31 * DAY) } });
      await UserModel.updateOne({ _id: bob.id }, { $set: { deletionRequestedAt: new Date(Date.now() - 10 * DAY) } });

      expect(await runAccountPurge()).toEqual({ purged: 1, failed: 0 });

      const tombstone = await UserModel.findById(alice.id).select('+password').lean();
      expect(tombstone).toMatchObject({ name: DELETED_USER_NAME, active: false, identities: [] });
      expect(tombstone!.email).not.toBe(alice.email);
      expect(tombstone!.password).toBeUndefined();
      expect(tombstone!.deletedAt).toBeInstanceOf(Date);
      expect(await UserModel.exists({ email: alice.email })).toBeNull();

      expect(await WorkspaceModel.exists({ _id: personal._id })).toBeNull();
      expect(await PollModel.exists({ _id: poll._id })).toBeNull();
      expect(await PresentationModel.countDocuments({ workspaceId: personal._id })).toBe(0);
      expect(await WorkspaceMemberModel.exists({ workspaceId: team._id, userId: alice.id })).toBeNull();
      expect(await PresentationModel.exists({ _id: teamDeck._id })).not.toBeNull();
      const answer = await ResponseModel.findOne({ pollId: bobPoll._id }).lean();
      expect(answer!.respondentId).toStartWith('deleted:');
      expect(await AuditEventModel.findOne({ action: 'poll.create', actorId: alice.id }).lean()).toMatchObject({ ip: null, ua: null });

      // Bob's grace period is still running.
      expect((await UserModel.findById(bob.id).lean())!.deletedAt).toBeNull();
      expect(await runAccountPurge()).toEqual({ purged: 0, failed: 0 });
    });

    it('deletes ended sessions past their retention date with their participants and answers', async () => {
      const deck = await createPresentation(server, alice, { title: 'Retained deck' });
      const session = (retainUntil: Date | null, isLive = false) =>
        PresentationSessionModel.create({
          presentationId: deck._id,
          workspaceId: deck.workspaceId,
          hostUserId: alice.id,
          runNumber: 1,
          joinCode: String(Math.floor(100000 + Math.random() * 800000)),
          status: isLive ? 'active' : 'ended',
          isLive,
          startedAt: new Date(Date.now() - 40 * DAY),
          endedAt: isLive ? null : new Date(Date.now() - 39 * DAY),
          retainUntil,
        });
      const expired = await session(new Date(Date.now() - DAY));
      const kept = await session(new Date(Date.now() + DAY));
      const forever = await session(null);
      const participant = await PresentationParticipantModel.create({
        presentationId: deck._id,
        sessionId: expired._id,
        name: 'Ada',
        deviceId: 'device-1',
        token: 'secret',
      });
      await PresentationAnswerModel.create({
        presentationId: deck._id,
        sessionId: expired._id,
        participantId: participant._id,
        slideId: new mongoose.Types.ObjectId(),
        slideIndex: 0,
        isCorrect: true,
        score: 1,
        timeMs: 1000,
      });

      expect(await runRetentionPurge()).toEqual({ sessions: 1 });
      expect(await PresentationSessionModel.exists({ _id: expired._id })).toBeNull();
      expect(await PresentationParticipantModel.countDocuments({ sessionId: expired._id })).toBe(0);
      expect(await PresentationAnswerModel.countDocuments({ sessionId: expired._id })).toBe(0);
      expect(await PresentationSessionModel.countDocuments({ _id: { $in: [kept._id, forever._id] } })).toBe(2);
    });
  });

  describe('participant self-removal', () => {
    it('removes a participant’s answers from an ended session and keeps everyone else’s rank', async () => {
      const deck = await createPresentation(server, alice, { title: 'Quiz' });
      const pid = deck._id as string;
      const host = (name: string, body?: unknown) => api('POST', `/api/presentations/${pid}/host/${name}`, alice, body);
      const opened = await host('open-lobby');
      expect(opened.status).toBe(200);
      const sessionId = opened.body.data.session.sessionId as string;
      const join = async (name: string) => (await api('POST', `/api/presentations/${pid}/join`, null, { name })).body.data;
      const ada = await join('Ada');
      const linus = await join('Linus');
      expect((await host('start')).status).toBe(200);
      for (const who of [ada, linus]) {
        const res = await api('POST', `/api/presentations/${pid}/answer`, null, {
          participantId: who.participantId,
          participantToken: who.token,
          slideIndex: 0,
          optionIndex: 0,
        });
        expect(res.status).toBe(200);
      }

      const erase = (who: { participantId: string; token: string }) =>
        api('DELETE', `/api/sessions/${sessionId}/participants/me`, null, { participantId: who.participantId, token: who.token });

      const live = await erase(ada);
      expect([live.status, live.body.code]).toEqual([409, 'SESSION_LIVE']);
      expect((await host('end')).status).toBe(200);

      expect((await erase({ ...ada, token: 'wrong-token' })).status).toBe(401);
      const res = await erase(ada);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ removed: true, answers: 1 });

      expect(await PresentationParticipantModel.exists({ _id: ada.participantId })).toBeNull();
      expect(await PresentationAnswerModel.countDocuments({ participantId: ada.participantId })).toBe(0);
      expect(await PresentationAnswerModel.countDocuments({ participantId: linus.participantId })).toBe(1);
      const stored = await PresentationSessionModel.findById(sessionId).lean();
      const names = stored!.finalLeaderboard.map((entry) => entry.name).sort();
      expect(names).toEqual(['Linus', REMOVED_PARTICIPANT_NAME].sort());

      const home = await api('GET', `/api/sessions/${sessionId}/me?participantId=${ada.participantId}&token=${ada.token}`, null);
      expect(home.status).toBe(404);
      expect((await erase(ada)).status).toBe(404);
    });
  });
});
