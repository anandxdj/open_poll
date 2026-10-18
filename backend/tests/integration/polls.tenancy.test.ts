import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { handleMcpTool } from '../../src/modules/mcp/mcp.tools';
import { PollModel } from '../../src/modules/polls/polls.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createPoll, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Polls are scoped to workspaces: every authenticated poll route acts in the
 * caller's workspace and authorizes with the tenancy policy, while the public
 * read and voting paths stay open.
 */
describeIntegration('poll tenancy', () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let alicePersonal: string;
  let bobPersonal: string;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    bob = await createVerifiedUser({ name: 'Bob' });
    alicePersonal = (await call(alice, 'GET', '/api/workspaces')).body.data.defaultWorkspaceId;
    bobPersonal = (await call(bob, 'GET', '/api/workspaces')).body.data.defaultWorkspaceId;
  });

  afterAll(async () => {
    await server?.close();
  });

  async function call(user: TestUser | null, method: string, path: string, body?: unknown, workspaceId?: string) {
    const headers: Record<string, string> = { ...(user?.headers ?? {}) };
    if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
    const res = await server.request(path, { method, headers, body });
    return { status: res.status, body: (await res.json()) as any };
  }

  const ids = (res: { body: any }) => res.body.data.map((poll: any) => poll._id);

  /** A team workspace owned by Alice with Bob as `role`; memberships are written directly (invites are W3-B1). */
  async function teamWithBob(role: 'editor' | 'viewer') {
    const team = await WorkspaceModel.create({
      name: 'Acme',
      slug: `acme-${new mongoose.Types.ObjectId()}`,
      type: 'team',
      ownerId: alice.id,
      plan: 'team',
    });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: alice.id, role: 'owner' });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: bob.id, role });
    return String(team._id);
  }

  it('creates polls in the current workspace and lists only that workspace', async () => {
    const poll = await createPoll(server, alice);
    expect(poll.workspaceId).toBe(alicePersonal);

    expect(ids(await call(alice, 'GET', '/api/polls'))).toEqual([poll._id]);
    expect(ids(await call(bob, 'GET', '/api/polls'))).toEqual([]);
  });

  it('keeps one user out of another user\'s polls: get draft, edit, close, publish, delete, responses', async () => {
    const draft = await createPoll(server, alice, { isPublished: false });
    const live = await createPoll(server, alice);

    expect((await call(alice, 'GET', `/api/polls/${draft._id}`)).status).toBe(200);
    expect((await call(bob, 'GET', `/api/polls/${draft._id}`)).status).toBe(404);
    expect((await call(null, 'GET', `/api/polls/${draft._id}`)).status).toBe(404);

    const denied = [
      await call(bob, 'PATCH', `/api/polls/${live._id}`, { title: 'Hijacked' }),
      await call(bob, 'POST', `/api/polls/${live._id}/close`),
      await call(bob, 'POST', `/api/polls/${live._id}/publish-results`),
      await call(bob, 'DELETE', `/api/polls/${live._id}`),
      await call(bob, 'GET', `/api/responses/poll/${live._id}/list`),
    ];
    for (const res of denied) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect((await PollModel.findById(live._id))!.title).toBe('Integration poll');

    expect((await call(alice, 'GET', `/api/responses/poll/${live._id}/list`)).status).toBe(200);
    expect((await call(alice, 'PATCH', `/api/polls/${live._id}`, { title: 'Renamed' })).body.data.title).toBe('Renamed');
    expect((await call(alice, 'DELETE', `/api/polls/${live._id}`)).status).toBe(200);
    expect(await PollModel.exists({ _id: live._id })).toBeNull();
  });

  it('keeps the public read, aggregate results and voting open', async () => {
    const live = await createPoll(server, alice);

    expect((await call(null, 'GET', `/api/polls/${live._id}`)).status).toBe(200);
    expect((await call(bob, 'GET', `/api/polls/${live._id}`)).status).toBe(200);
    // A stale workspace selection must not break the public page.
    expect((await call(bob, 'GET', `/api/polls/${live._id}`, undefined, String(new mongoose.Types.ObjectId()))).status).toBe(200);
    expect((await call(null, 'GET', `/api/responses/poll/${live._id}/summary`)).status).toBe(200);

    const ballot = await call(null, 'POST', `/api/responses/poll/${live._id}/ballot`);
    expect(ballot.status).toBe(200);
    const vote = await call(null, 'POST', '/api/responses', {
      pollId: live._id,
      ballotToken: ballot.body.data.ballotToken,
      answers: [{ questionId: live.questions[0]._id, selectedOptionIndex: 0 }],
    });
    expect(vote.status).toBe(201);
  });

  it('answers 403 WORKSPACE_FORBIDDEN for an X-Workspace-Id the caller is not a member of', async () => {
    for (const [method, path] of [
      ['GET', '/api/polls'],
      ['POST', '/api/polls'],
      ['GET', `/api/responses/poll/${new mongoose.Types.ObjectId()}/list`],
    ] as const) {
      const res = await call(bob, method, path, method === 'POST' ? pollBody('Not here') : undefined, alicePersonal);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('WORKSPACE_FORBIDDEN');
    }
    expect(await PollModel.countDocuments({ creatorId: bob.id })).toBe(0);
  });

  it('shares a team workspace\'s polls with its members, by role, and only inside it', async () => {
    const team = await teamWithBob('editor');
    const teamPoll = (await call(alice, 'POST', '/api/polls', pollBody('Team poll'), team)).body.data;
    expect(teamPoll.workspaceId).toBe(team);

    expect(ids(await call(bob, 'GET', '/api/polls', undefined, team))).toEqual([teamPoll._id]);
    expect(ids(await call(bob, 'GET', '/api/polls', undefined, bobPersonal))).toEqual([]);
    expect(ids(await call(alice, 'GET', '/api/polls'))).toEqual([]);

    // Acting from another workspace is refused even for the poll's creator.
    expect((await call(alice, 'PATCH', `/api/polls/${teamPoll._id}`, { title: 'Hijacked' }, alicePersonal)).status).toBe(403);
    expect((await call(bob, 'PATCH', `/api/polls/${teamPoll._id}`, { title: 'Edited by Bob' }, team)).status).toBe(200);

    await WorkspaceMemberModel.updateOne({ workspaceId: team, userId: bob.id }, { $set: { role: 'viewer' } });
    expect((await call(bob, 'GET', `/api/responses/poll/${teamPoll._id}/list`, undefined, team)).status).toBe(200);
    expect((await call(bob, 'PATCH', `/api/polls/${teamPoll._id}`, { title: 'Hijacked' }, team)).status).toBe(403);
    expect((await call(bob, 'DELETE', `/api/polls/${teamPoll._id}`, undefined, team)).status).toBe(403);
    expect((await call(bob, 'POST', '/api/polls', pollBody('Viewer poll'), team)).status).toBe(403);
  });

  it('serves polls from before migration 020 to their creator, in the personal workspace only', async () => {
    const team = await teamWithBob('editor');
    const legacy = await PollModel.create({ ...pollBody('Legacy'), creatorId: alice.id });
    expect(legacy.workspaceId).toBeUndefined();

    expect(ids(await call(alice, 'GET', '/api/polls'))).toEqual([String(legacy._id)]);
    expect(ids(await call(alice, 'GET', '/api/polls', undefined, team))).toEqual([]);
    expect(ids(await call(bob, 'GET', '/api/polls', undefined, team))).toEqual([]);

    expect((await call(alice, 'PATCH', `/api/polls/${legacy._id}`, { title: 'Still mine' })).status).toBe(200);
    expect((await call(bob, 'PATCH', `/api/polls/${legacy._id}`, { title: 'Hijacked' }, team)).status).toBe(403);
  });

  it('uses the default workspace, as switched, for requests without X-Workspace-Id', async () => {
    const team = await teamWithBob('editor');
    expect((await call(alice, 'POST', `/api/workspaces/${team}/switch`)).status).toBe(200);

    const poll = (await call(alice, 'POST', '/api/polls', pollBody('Lands in the team'))).body.data;
    expect(poll.workspaceId).toBe(team);
    expect(ids(await call(alice, 'GET', '/api/polls'))).toEqual([poll._id]);
    expect(ids(await call(alice, 'GET', '/api/polls', undefined, alicePersonal))).toEqual([]);
  });

  it('creates MCP polls in the token owner\'s default workspace', async () => {
    const mcp = { userId: alice.id, tokenId: 'test-token', scopes: ['poll:read', 'poll:create'] as any };
    const question = { text: 'Pick one', options: ['A', 'B'] };

    const personal: any = await handleMcpTool('create_poll', { title: 'Via MCP', questions: [question] }, mcp);
    expect(String(personal.poll.workspaceId)).toBe(alicePersonal);

    const team = await teamWithBob('editor');
    expect((await call(alice, 'POST', `/api/workspaces/${team}/switch`)).status).toBe(200);
    const inTeam: any = await handleMcpTool('create_poll', { title: 'Via MCP, team', questions: [question] }, mcp);
    expect(String(inTeam.poll.workspaceId)).toBe(team);

    const listed: any = await handleMcpTool('list_polls', {}, mcp);
    expect(listed.polls.map((poll: any) => poll._id)).toEqual([inTeam.poll._id]);
    expect(ids(await call(bob, 'GET', '/api/polls', undefined, team))).toEqual([inTeam.poll._id]);
  });
});

function pollBody(title: string) {
  return {
    title,
    pollType: 'POLL' as const,
    isPublished: true,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    questions: [{ text: 'Best runtime?', options: ['Bun', 'Node'], type: 'single' as const }],
  };
}
