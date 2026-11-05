import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { setStorageDriver, type StorageDriver } from '../../src/common/storage/storage';
import { createApp } from '../../src/http/createApp';
import { PresentationModel } from '../../src/modules/presentations/models/presentation.model';
import { PollModel } from '../../src/modules/polls/polls.model';
import { ResourceShareModel } from '../../src/modules/workspaces/resourceShare.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { listRouteInfo, type RouteInfo } from '../helpers/routeTable';
import { createPoll, createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Tenancy isolation (W3-B1): two workspaces are fully isolated.
 *
 * Part 1 introspects the route table: every `/api` route either runs a
 * workspace-context middleware (`workspaceContext()` for X-Workspace-Id,
 * `pathWorkspaceContext()` for /api/workspaces/:workspaceId/...) or is on the
 * explicit allow-list below, each with the reason it needs none. A new route
 * that does neither fails this test; fix the route, or (for a public,
 * token-credential or user-level route) add it to the allow-list with a reason
 * a reviewer can check. The middleware only builds the context: the policy
 * (`assertCan`) is then proven by part 2, which attacks one workspace's
 * resources from another over REST and sockets.
 */

// ---------- Part 1: the route table ----------

interface Allowed {
  /** Methods the entry covers; every method when omitted. */
  methods?: readonly string[];
  /** Exact path, or a prefix ending in `*`. `:name` segments compare literally. */
  path: string;
  reason: string;
  /** Not mounted yet in this branch (a later package adds it): exempt from the stale-entry check. */
  planned?: boolean;
}

const bothAliases = (path: string, reason: string, methods?: readonly string[]): Allowed[] => [
  { path, reason, methods },
  { path: path.replace('/api/presentations', '/api/quizzes'), reason, methods },
];

const ALLOWED: readonly Allowed[] = [
  // Identity and sign-in: nothing here belongs to a workspace yet.
  { path: '/api/auth/*', reason: 'sign-in, sign-up, token refresh and the profile of the signed-in user' },
  { path: '/api/capabilities', reason: 'public deployment capabilities, no tenant data' },
  { path: '/api/plans', reason: 'public plan catalogue' },
  { path: '/api/themes/presets', methods: ['GET'], reason: 'built-in themes and font choices, the same for everyone' },
  { path: '/api/oembed', reason: 'public oEmbed discovery of published embeds', planned: true },
  { path: '/api/public/*', reason: 'public by design: shared results by token, domain resolution for TLS' },
  { path: '/api/billing/webhook', reason: 'Stripe webhook, authenticated by signature' },
  { path: '/api/sso/*', reason: 'pre-sign-in SSO flow (discover, login redirect, ACS, metadata, callback)' },

  // Credentials of their own.
  { path: '/api/me/*', reason: 'the signed-in user’s own account (privacy page, data export, re-auth); content only from workspaces they still belong to' },
  { path: '/api/me', methods: ['DELETE'], reason: 'the signed-in user deletes their own account' },
  { path: '/api/mcp/tokens*', reason: 'MCP tokens belong to the user; tools act in the owner’s default workspace through the policy' },
  { methods: ['POST'], path: '/api/ai/generate', reason: 'authenticated and rate limited; stores nothing' },
  { methods: ['POST'], path: '/api/ai/generate-quiz', reason: 'authenticated and rate limited; stores nothing' },
  { methods: ['POST'], path: '/api/ai/generate-and-save', reason: 'authenticated and rate limited; PollService.createPoll checks deck:create in the owner’s default workspace' },
  { methods: ['GET'], path: '/api/imports/templates/questions.:format', reason: 'static question-file template (CSV or Excel), no tenant data; rate limited' },
  { methods: ['GET'], path: '/api/imports/:id', reason: 'import job status: ImportService.get requires the job’s creator who is still an active member of its workspace (404 otherwise)' },
  { path: '/api/invites/:token*', reason: 'the single-use token is the credential; accepting also needs the invited verified email' },
  { path: '/api/remote/:token*', reason: 'remote-control token is the credential', planned: true },

  // The workspaces module resolves the workspace named in the path inside the controller.
  { methods: ['GET', 'POST'], path: '/api/workspaces', reason: 'list the user’s workspaces / create a team workspace' },
  { path: '/api/workspaces/:id', methods: ['GET', 'PATCH'], reason: 'resolveWorkspaceContext(path id) in the controller: active membership or 403 WORKSPACE_FORBIDDEN' },
  { path: '/api/workspaces/:id/switch', methods: ['POST'], reason: 'resolveWorkspaceContext(path id) in the controller' },

  // Participants: no account, they hold a participant or guest token issued by the join/ballot flow.
  ...bothAliases('/api/presentations/code/:code', 'join code lookup by participants', ['GET']),
  ...bothAliases('/api/presentations/:id/join', 'participant join (nickname)', ['POST']),
  ...bothAliases('/api/presentations/:id/answer', 'participant answer, participant token', ['POST']),
  ...bothAliases('/api/presentations/:id/me', 'participant state, participant token', ['GET']),
  ...bothAliases('/api/presentations/:id/live-state', 'participant resync, participant token', ['GET']),
  { path: '/api/presentations/:presentationId/qna*', reason: 'participant Q&A, participant token (the host side runs workspace context)' },
  { path: '/api/sessions/:sessionId/me', methods: ['GET'], reason: 'participant take-home, participant token' },
  { path: '/api/sessions/:sessionId/participants/me', methods: ['DELETE'], reason: 'a participant removes their own answers, participant token' },
  { path: '/api/responses/poll/:pollId/ballot', methods: ['POST'], reason: 'public poll voting' },
  { path: '/api/responses/guest-token', methods: ['POST'], reason: 'public poll voting' },
  { path: '/api/responses', methods: ['POST'], reason: 'public poll voting, signed ballot' },
  { path: '/api/responses/poll/:pollId/summary', methods: ['GET'], reason: 'public result summary of a published poll' },
  { path: '/api/polls/:id', methods: ['GET'], reason: 'public read: published polls are open, drafts are policy-checked in the controller (readerContext)' },
];

const matches = (entry: Allowed, route: RouteInfo) => {
  if (entry.methods && !entry.methods.includes(route.method)) return false;
  return entry.path.endsWith('*') ? route.path.startsWith(entry.path.slice(0, -1)) : route.path === entry.path;
};

describe('tenancy isolation: route table', () => {
  const routes = listRouteInfo(createApp()).filter((route) => route.path.startsWith('/api/'));

  it('finds the routes it is meant to guard', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes.some((route) => route.path === '/api/presentations/:id/host/start')).toBe(true);
  });

  it('runs workspace context on every /api route that is not allow-listed', () => {
    const unguarded = routes.filter((route) => route.contexts.length === 0 && !ALLOWED.some((entry) => matches(entry, route)));
    expect(unguarded.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('does not allow-list a route that already runs workspace context', () => {
    const redundant = routes.filter((route) => route.contexts.length > 0 && ALLOWED.some((entry) => matches(entry, route)));
    expect(redundant.map((route) => `${route.method} ${route.path}`)).toEqual([]);
  });

  it('keeps the allow-list free of stale entries', () => {
    const stale = ALLOWED.filter((entry) => !entry.planned && !routes.some((route) => matches(entry, route)));
    expect(stale.map((entry) => `${entry.methods?.join('|') ?? '*'} ${entry.path}`)).toEqual([]);
  });

  it('uses the path-based context for every /api/workspaces/:workspaceId/... route', () => {
    const nested = routes.filter((route) => /^\/api\/workspaces\/:workspaceId\//.test(route.path));
    expect(nested.length).toBeGreaterThanOrEqual(7);
    for (const route of nested) {
      expect(route.contexts, `${route.method} ${route.path}`).toContain('path');
    }
  });

  it('guards the host, deck, poll, library, upload, share and audit surfaces with a header context', () => {
    const guarded = (prefix: string) => routes.filter((route) => route.path.startsWith(prefix) && route.contexts.includes('header'));
    for (const prefix of [
      '/api/presentations/:id/host/',
      '/api/polls',
      '/api/library',
      '/api/uploads/',
      '/api/shares',
      '/api/audit',
    ]) {
      expect(guarded(prefix).length, prefix).toBeGreaterThan(0);
    }
  });
});

// ---------- Part 2: the cross-workspace matrix ----------

const OBJECT_ID = () => String(new mongoose.Types.ObjectId());
const DENIED = [403, 404];

describeIntegration('tenancy isolation: cross-workspace matrix', () => {
  let server: TestServer;
  let alice!: TestUser; // owner of workspace A
  let bob!: TestUser; // owner of workspace B
  let carol!: TestUser; // viewer in A
  let dana!: TestUser; // presenter in A
  let wsA!: string;
  let wsB!: string;
  let deckA: any;
  let draftA: any;
  let publishedA: any;

  const call = async (user: TestUser | null, method: string, path: string, body?: unknown, workspaceId?: string | null) => {
    const headers: Record<string, string> = { ...(user?.headers ?? {}) };
    if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
    const res = await server.request(path, { method, headers, body });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const inWorkspace = (user: TestUser, workspaceId: string): TestUser => ({
    ...user,
    headers: { ...user.headers, 'x-workspace-id': workspaceId } as any,
  });

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  afterAll(async () => {
    await server?.close();
  });

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    bob = await createVerifiedUser({ name: 'Bob' });
    carol = await createVerifiedUser({ name: 'Carol' });
    dana = await createVerifiedUser({ name: 'Dana' });
    wsA = (await call(alice, 'POST', '/api/workspaces', { name: 'Alpha' })).body.data.workspace._id;
    wsB = (await call(bob, 'POST', '/api/workspaces', { name: 'Beta' })).body.data.workspace._id;
    await WorkspaceModel.updateMany({ _id: { $in: [wsA, wsB] } }, { $set: { plan: 'team' } });
    await WorkspaceMemberModel.create({ workspaceId: wsA, userId: carol.id, role: 'viewer' });
    await WorkspaceMemberModel.create({ workspaceId: wsA, userId: dana.id, role: 'presenter' });

    deckA = await createPresentation(server, inWorkspace(alice, wsA), { title: 'Alpha deck' });
    draftA = await createPoll(server, inWorkspace(alice, wsA), { title: 'Alpha draft poll', isPublished: false });
    publishedA = await createPoll(server, inWorkspace(alice, wsA), { title: 'Alpha published poll' });
  });

  /** Every way Bob can reach for Alpha's deck and polls; each must be denied. */
  const attacks = (): [string, string, unknown?][] => {
    const deck = `/api/presentations/${deckA._id}`;
    return [
      ['GET', deck],
      ['PATCH', deck, { title: 'pwned' }],
      ['DELETE', deck],
      ['GET', `${deck}/host/state`],
      ['POST', `${deck}/host/open-lobby`],
      ['POST', `${deck}/host/start`],
      ['POST', `${deck}/host/goto`, { slideIndex: 0 }],
      ['POST', `${deck}/host/advance`, {}],
      ['POST', `${deck}/host/close`],
      ['POST', `${deck}/host/reopen`],
      ['POST', `${deck}/host/reveal`],
      ['POST', `${deck}/host/end`],
      ['GET', `${deck}/sessions`],
      ['GET', `/api/quizzes/${deckA._id}`],
      ['POST', `/api/quizzes/${deckA._id}/host/start`],
      ['GET', `/api/shares?resourceType=presentation&resourceId=${deckA._id}`],
      ['PUT', `/api/shares?resourceType=presentation&resourceId=${deckA._id}`, { shares: [] }],
      ['PATCH', `/api/polls/${draftA._id}`, { title: 'pwned' }],
      ['PATCH', `/api/polls/${publishedA._id}`, { title: 'pwned' }],
      ['POST', `/api/polls/${publishedA._id}/close`],
      ['POST', `/api/polls/${publishedA._id}/publish-results`],
      ['DELETE', `/api/polls/${publishedA._id}`],
      ['GET', `/api/polls/${draftA._id}`],
      ['GET', `/api/responses/poll/${publishedA._id}/list`],
      ['POST', `/api/library/convert/poll/${publishedA._id}`],
      ['GET', `/api/workspaces/${wsA}`],
      ['PATCH', `/api/workspaces/${wsA}`, { name: 'pwned' }],
      ['POST', `/api/workspaces/${wsA}/switch`],
      ['GET', `/api/workspaces/${wsA}/members`],
      ['PATCH', `/api/workspaces/${wsA}/members/${alice.id}`, { role: 'viewer' }],
      ['DELETE', `/api/workspaces/${wsA}/members/${alice.id}`],
      ['POST', `/api/workspaces/${wsA}/members/${bob.id}/transfer-ownership`],
      ['GET', `/api/workspaces/${wsA}/invites`],
      ['POST', `/api/workspaces/${wsA}/invites`, { email: bob.email, role: 'admin' }],
      ['DELETE', `/api/workspaces/${wsA}/invites/${OBJECT_ID()}`],
    ];
  };

  const asBob: [string, string | null][] = [
    ['his own workspace selected', wsB],
    ['no workspace header (personal default)', null],
    ["Alpha's workspace selected", wsA],
  ];

  for (const [label, workspace] of asBob) {
    it(`denies every Alpha deck, poll, share and workspace route to Bob with ${label}`, async () => {
      for (const [method, path, body] of attacks()) {
        const res = await call(bob, method, path, body, workspace);
        expect(DENIED, `${method} ${path} → ${res.status}`).toContain(res.status);
      }

      // Nothing changed.
      expect((await PresentationModel.findById(deckA._id))).toMatchObject({ title: 'Alpha deck', status: 'draft', activeSessionId: null });
      expect(await PollModel.countDocuments({ _id: { $in: [draftA._id, publishedA._id] } })).toBe(2);
      expect((await PollModel.findById(publishedA._id))).toMatchObject({ title: 'Alpha published poll' });
      expect(await ResourceShareModel.countDocuments({})).toBe(0);
      expect(await WorkspaceMemberModel.countDocuments({ workspaceId: wsA })).toBe(3);
      expect(String((await WorkspaceModel.findById(wsA))!.ownerId)).toBe(alice.id);
      expect((await WorkspaceModel.findById(wsA))!.name).toBe('Alpha');
    });
  }

  it('lets Alice do all of that (the attacks are not failing for another reason)', async () => {
    const deck = `/api/presentations/${deckA._id}`;
    expect((await call(alice, 'GET', deck, undefined, wsA)).status).toBe(200);
    expect((await call(alice, 'PATCH', deck, { title: 'Renamed' }, wsA)).status).toBe(200);
    expect((await call(alice, 'GET', `${deck}/host/state`, undefined, wsA)).status).toBe(200);
    expect((await call(alice, 'GET', `${deck}/sessions`, undefined, wsA)).status).toBe(200);
    expect((await call(alice, 'PATCH', `/api/polls/${draftA._id}`, { title: 'Draft renamed' }, wsA)).status).toBe(200);
    expect((await call(alice, 'GET', `/api/polls/${draftA._id}`, undefined, wsA)).status).toBe(200);
    expect((await call(alice, 'GET', `/api/responses/poll/${publishedA._id}/list`, undefined, wsA)).status).toBe(200);
    expect((await call(alice, 'GET', `/api/workspaces/${wsA}/members`)).status).toBe(200);
    expect((await call(alice, 'GET', `/api/shares?resourceType=presentation&resourceId=${deckA._id}`, undefined, wsA)).status).toBe(200);
  });

  it('keeps Alpha out of Beta’s lists, library and audit log, and Beta out of Alpha’s', async () => {
    const deckB = await createPresentation(server, inWorkspace(bob, wsB), { title: 'Beta deck' });
    const pollB = await createPoll(server, inWorkspace(bob, wsB), { title: 'Beta poll' });
    await call(alice, 'PATCH', `/api/workspaces/${wsA}`, { name: 'Alpha renamed' }); // an Alpha audit event
    await new Promise((resolve) => setTimeout(resolve, 100));

    const seenByBob = await Promise.all(
      ['/api/presentations', '/api/polls', '/api/library', '/api/audit', `/api/workspaces/${wsB}/members`].map(async (path) => {
        const res = await call(bob, 'GET', path, undefined, wsB);
        expect(res.status, path).toBe(200);
        return JSON.stringify(res.body);
      }),
    );
    for (const text of seenByBob) {
      for (const secret of [deckA._id, draftA._id, publishedA._id, alice.email, 'Alpha deck', 'Alpha published poll', wsA]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(seenByBob[0]).toContain(deckB._id);
    expect(seenByBob[1]).toContain(pollB._id);
    expect(seenByBob[2]).toContain(deckB._id);
    expect(seenByBob[3]).not.toContain('workspace.update'); // Alpha's event

    const seenByAlice = await Promise.all(
      ['/api/presentations', '/api/polls', '/api/library', '/api/audit'].map(async (path) => JSON.stringify((await call(alice, 'GET', path, undefined, wsA)).body)),
    );
    for (const text of seenByAlice) {
      expect(text).not.toContain(deckB._id);
      expect(text).not.toContain(pollB._id);
      expect(text).not.toContain('Beta');
    }
  });

  it('files everything a user creates in the selected workspace, whatever the body claims', async () => {
    const deck = await call(bob, 'POST', '/api/presentations', {
      title: 'Claims Alpha',
      workspaceId: wsA,
      creatorId: alice.id,
      slides: [{ type: 'heading', content: { title: 'Hi' } }],
    }, wsB);
    expect(deck.status, JSON.stringify(deck.body)).toBe(201);
    expect(String((await PresentationModel.findById(deck.body.data._id))!.workspaceId)).toBe(wsB);
    expect((await PresentationModel.findById(deck.body.data._id))!.creatorId).toBe(bob.id);
    const poll = await call(bob, 'POST', '/api/polls', {
      title: 'Claims Alpha',
      pollType: 'POLL',
      isPublished: true,
      workspaceId: wsA,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      questions: [{ text: 'Which one?', options: ['a', 'b'], type: 'single' }],
    }, wsB);
    expect(poll.status, JSON.stringify(poll.body)).toBe(201);
    expect(String((await PollModel.findById(poll.body.data._id))!.workspaceId)).toBe(wsB);
    expect(await PresentationModel.countDocuments({ workspaceId: wsA })).toBe(1);
    expect(await PollModel.countDocuments({ workspaceId: wsA })).toBe(2);
    expect((await call(bob, 'POST', '/api/presentations', { title: 'x', slides: [] }, wsA)).body.code).toBe('WORKSPACE_FORBIDDEN');
    const alienPoll = { title: 'Not allowed', pollType: 'POLL', isPublished: true, expiresAt: new Date(Date.now() + 3600_000).toISOString(), questions: [{ text: 'Which one?', options: ['a', 'b'], type: 'single' }] };
    const alien = await call(bob, 'POST', '/api/polls', alienPoll, wsA);
    expect(alien.body, JSON.stringify(alien)).toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
  });

  it('applies the role matrix inside a workspace as well: viewers read, presenters host, neither edits', async () => {
    const deck = `/api/presentations/${deckA._id}`;
    expect((await call(carol, 'GET', deck, undefined, wsA)).status).toBe(200);
    expect((await call(dana, 'GET', deck, undefined, wsA)).status).toBe(200);
    for (const user of [carol, dana]) {
      expect((await call(user, 'PATCH', deck, { title: 'x' }, wsA)).status).toBe(403);
      expect((await call(user, 'DELETE', deck, undefined, wsA)).status).toBe(403);
      expect((await call(user, 'POST', '/api/presentations', { title: 'x', slides: [{ type: 'heading', content: { title: 'x' } }] }, wsA)).status).toBe(403);
      expect((await call(user, 'GET', `/api/shares?resourceType=presentation&resourceId=${deckA._id}`, undefined, wsA)).status).toBe(403);
      expect((await call(user, 'GET', '/api/audit', undefined, wsA)).status).toBe(403);
      expect((await call(user, 'POST', `/api/workspaces/${wsA}/invites`, { email: 'x@example.com', role: 'viewer' })).status).toBe(403);
      expect((await call(user, 'PATCH', `/api/workspaces/${wsA}/members/${alice.id}`, { role: 'viewer' })).status).toBe(403);
    }
    expect((await call(carol, 'GET', `${deck}/host/state`, undefined, wsA)).status).toBe(403);
    expect((await call(dana, 'GET', `${deck}/host/state`, undefined, wsA)).status).toBe(200);
    expect((await call(carol, 'GET', `/api/responses/poll/${publishedA._id}/list`, undefined, wsA)).status).toBe(200);
  });

  it('keeps uploads inside the workspace that made them', async () => {
    const driver: StorageDriver = {
      enabled: true,
      presignPut: async (objectKey) => ({ key: objectKey, url: `https://s3.test/${objectKey}`, method: 'PUT', headers: {}, expiresAt: new Date(Date.now() + 60_000) }),
      publicUrl: (objectKey) => `https://cdn.test/${objectKey}`,
      stat: async (objectKey) => ({ key: objectKey, size: 100, type: 'image/png' }),
      getObject: async () => {
        throw new Error('unused');
      },
      putObject: async () => {},
      delete: async () => {},
    };
    const previous = setStorageDriver(driver);
    try {
      const presign = await call(alice, 'POST', '/api/uploads/presign', { purpose: 'slide_image', mime: 'image/png', bytes: 100 }, wsA);
      expect(presign.status).toBe(201);
      const uploaded: string = presign.body.data.key;
      expect(uploaded.startsWith(`uploads/${wsA}/`)).toBe(true);

      // Bob cannot finish (or probe) Alice's upload from either workspace.
      expect((await call(bob, 'POST', '/api/uploads/complete', { key: uploaded }, wsB)).body.code).toBe('UPLOAD_NOT_FOUND');
      expect((await call(bob, 'POST', '/api/uploads/complete', { key: uploaded }, wsA)).body.code).toBe('WORKSPACE_FORBIDDEN');
      expect((await call(bob, 'POST', '/api/uploads/presign', { purpose: 'slide_image', mime: 'image/png', bytes: 100 }, wsA)).status).toBe(403);
      expect((await call(carol, 'POST', '/api/uploads/presign', { purpose: 'slide_image', mime: 'image/png', bytes: 100 }, wsA)).status).toBe(403);

      expect((await call(alice, 'POST', '/api/uploads/complete', { key: uploaded }, wsA)).status).toBe(201);
      // ... and cannot point his slides at Alice's asset.
      const slide = { type: 'image', content: { key: uploaded, alt: 'stolen' } };
      const stolen = await call(bob, 'POST', '/api/presentations', { title: 'Uses Alpha media', slides: [slide] }, wsB);
      expect(stolen).toMatchObject({ status: 400, body: { code: 'MEDIA_NOT_FOUND' } });
      expect((await call(alice, 'POST', '/api/presentations', { title: 'Uses own media', slides: [slide] }, wsA)).status).toBe(201);
    } finally {
      setStorageDriver(previous);
    }
  });

  describe('sockets', () => {
    const connect = (user: TestUser | null) =>
      new Promise<ReturnType<TestServer['connectSocket']>>((resolve, reject) => {
        const socket = server.connectSocket(user ? { auth: { token: `Bearer ${user.accessToken}` } } : {});
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
      });
    const joinAsHost = async (user: TestUser | null, presentationId: string, extra: Record<string, unknown> = {}) => {
      const socket = await connect(user);
      return (await socket.timeout(5_000).emitWithAck('live:join', { presentationId, role: 'host', ...extra })) as {
        ok: boolean;
        error?: string;
        role?: string;
      };
    };

    it('refuses a host join on another workspace’s deck, however the token is presented', async () => {
      // Handshake auth, then token in the payload, then both, then someone else's id.
      expect(await joinAsHost(bob, deckA._id)).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await joinAsHost(null, deckA._id, { accessToken: bob.accessToken })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await joinAsHost(bob, deckA._id, { accessToken: bob.accessToken })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await joinAsHost(null, deckA._id)).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
      expect(await joinAsHost(bob, OBJECT_ID())).toEqual({ ok: false, error: 'FORBIDDEN' });
    });

    it('lets the owning workspace host by role: owner and presenter yes, viewer no, suspended no', async () => {
      expect(await joinAsHost(alice, deckA._id)).toEqual({ ok: true, role: 'host' });
      expect(await joinAsHost(dana, deckA._id)).toEqual({ ok: true, role: 'host' });
      expect(await joinAsHost(carol, deckA._id)).toEqual({ ok: false, error: 'FORBIDDEN' });
      await WorkspaceMemberModel.updateOne({ workspaceId: wsA, userId: dana.id }, { $set: { status: 'suspended' } });
      expect(await joinAsHost(dana, deckA._id)).toEqual({ ok: false, error: 'FORBIDDEN' });
    });

    it('lets a presenter share on one deck host it, and a revoked share stop working', async () => {
      expect(await joinAsHost(carol, deckA._id)).toEqual({ ok: false, error: 'FORBIDDEN' });
      const put = await call(alice, 'PUT', `/api/shares?resourceType=presentation&resourceId=${deckA._id}`, {
        shares: [{ principalType: 'user', principalId: carol.id, role: 'presenter' }],
      }, wsA);
      expect(put.status).toBe(200);
      expect(await joinAsHost(carol, deckA._id)).toEqual({ ok: true, role: 'host' });
      await call(alice, 'PUT', `/api/shares?resourceType=presentation&resourceId=${deckA._id}`, { shares: [] }, wsA);
      expect(await joinAsHost(carol, deckA._id)).toEqual({ ok: false, error: 'FORBIDDEN' });
      // A share for someone outside the workspace never reaches them.
      await ResourceShareModel.create({
        workspaceId: wsA,
        resourceType: 'presentation',
        resourceId: deckA._id,
        principalType: 'user',
        principalId: bob.id,
        role: 'presenter',
      });
      expect(await joinAsHost(bob, deckA._id)).toEqual({ ok: false, error: 'FORBIDDEN' });
    });
  });
});
