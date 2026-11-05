import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { env } from '../../src/common/config/env';
import { hashToken } from '../../src/common/utils/jwt.utils';
import { ScreenTokenModel } from '../../src/modules/embeds/screenToken.model';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * W4-D through the real app (createApp, Mongo, Redis, sockets): oEmbed for
 * each kind of embed and refusal of anything else, screen tokens (create,
 * stage read, live screen socket, revoke, roles, other workspaces), the embed
 * policy the frontend proxy reads, and a deck that does not allow embedding.
 */

type Envelope = { type: string; sessionId: string | null; payload: Record<string, any> };
type Body<T = any> = { success: boolean; message: string; code?: string; data: T };

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

const SELECT = {
  type: 'select_answer',
  question: 'Capital of France?',
  notes: 'SPEAKER-NOTES-SECRET',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 60,
};
const HEADING = { type: 'heading', content: { title: 'Welcome' } };

const FRONTEND = () => new URL(env.FRONTEND_URL).origin;

describeIntegration('embeds, oEmbed and screens', () => {
  let server: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let wsA: string;
  let wsB: string;

  const call = async <T = any>(
    method: string,
    path: string,
    options: { user?: TestUser | null; body?: unknown; headers?: Record<string, string>; workspaceId?: string } = {},
  ) => {
    const headers: Record<string, string> = { ...(options.user?.headers ?? {}), ...(options.headers ?? {}) };
    if (options.workspaceId) headers['x-workspace-id'] = options.workspaceId;
    const res = await server.request(path, { method, headers, body: options.body });
    return { status: res.status, headers: res.headers, body: (await res.json().catch(() => null)) as Body<T> & Record<string, any> };
  };

  const createDeck = async (slides: unknown[] = [SELECT], user = alice, workspaceId = wsA) => {
    const res = await call('POST', '/api/presentations', { user, workspaceId, body: { title: 'Embed deck', slides } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; joinCode: string; slides: { _id: string }[] };
  };

  const allowEmbed = async (pid: string, allowed = true) => {
    const res = await call('PATCH', `/api/presentations/${pid}`, {
      user: alice,
      workspaceId: wsA,
      body: { settings: { embed: { allowed } } },
    });
    expect(res.status).toBe(200);
  };

  const host = (pid: string, command: string, body?: unknown) =>
    call('POST', `/api/presentations/${pid}/host/${command}`, { user: alice, workspaceId: wsA, body });

  const createToken = (pid: string, user = alice, workspaceId = wsA, label = 'Hall screen') =>
    call<{ token: string; id: string; prefix: string; last4: string }>('POST', '/api/embeds/screen-tokens', {
      user,
      workspaceId,
      body: { presentationId: pid, label },
    });

  const stage = (token: string) => call('GET', '/api/embeds/stage', { headers: { 'x-screen-token': token } });

  const oembed = (url: string, extra = '') => call('GET', `/api/oembed?url=${encodeURIComponent(url)}${extra}`);

  const policy = (query: string) => call<{ allowed: boolean; reason: string | null; frameAncestors: string[] }>('GET', `/api/embeds/policy?${query}`);

  /** A socket following the deck as a screen (`live:join` role `screen`). */
  const screenSocket = async (pid: string, screenToken: string) => {
    const socket = server.connectSocket();
    const events: Envelope[] = [];
    const revoked: unknown[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    socket.on('screen:revoked', (payload: unknown) => revoked.push(payload));
    await waitFor(() => socket.connected, 'socket connect');
    const ack = await socket.timeout(3000).emitWithAck('live:join', { presentationId: pid, role: 'screen', screenToken });
    return { socket, events, revoked, ack };
  };

  const hostSocket = async (pid: string) => {
    const socket = server.connectSocket({ auth: { token: `Bearer ${alice.accessToken}` } });
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    await waitFor(() => socket.connected, 'socket connect');
    const ack = await socket.timeout(3000).emitWithAck('live:join', { presentationId: pid, role: 'host' });
    expect(ack).toEqual({ ok: true, role: 'host' });
    return { socket, events };
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    alice = await createVerifiedUser({ name: 'Alice' });
    bob = await createVerifiedUser({ name: 'Bob' });
    carol = await createVerifiedUser({ name: 'Carol' });
    wsA = (await call('POST', '/api/workspaces', { user: alice, body: { name: 'Alpha' } })).body.data.workspace._id;
    wsB = (await call('POST', '/api/workspaces', { user: bob, body: { name: 'Beta' } })).body.data.workspace._id;
    await WorkspaceModel.updateMany({ _id: { $in: [wsA, wsB] } }, { $set: { plan: 'team' } });
    await WorkspaceMemberModel.create({ workspaceId: wsA, userId: carol.id, role: 'presenter' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  // ---------------------------------------------------------------------------
  // Screen tokens
  // ---------------------------------------------------------------------------

  it('creates a screen token shown once, stores only its hash, lists it without the secret', async () => {
    const deck = await createDeck();
    const created = await createToken(deck._id);
    expect(created.status).toBe(201);
    const { token, id, prefix, last4 } = created.body.data;
    expect(token).toMatch(/^scr_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(token.slice(0, 8));
    expect(last4).toBe(token.slice(-4));

    const stored = await ScreenTokenModel.findById(id).lean();
    expect(stored?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(String(stored?.workspaceId)).toBe(wsA);

    const list = await call('GET', `/api/embeds/screen-tokens?presentationId=${deck._id}`, { user: alice, workspaceId: wsA });
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ id, label: 'Hall screen', prefix, last4, presentationId: deck._id, lastUsedAt: null }),
    ]);
    expect(JSON.stringify(list.body.data)).not.toContain(token);
  });

  it('lets only owner/admin/editor manage screen tokens, and never across workspaces', async () => {
    const deck = await createDeck();
    // A presenter of the same workspace may host, not hand the deck out.
    expect((await createToken(deck._id, carol, wsA)).status).toBe(403);
    expect((await call('GET', `/api/embeds/screen-tokens?presentationId=${deck._id}`, { user: carol, workspaceId: wsA })).status).toBe(403);

    // Bob, in his own workspace, with no workspace header, or naming Alpha (not a member).
    for (const workspaceId of [wsB, undefined, wsA]) {
      const res = await createToken(deck._id, bob, workspaceId as string);
      expect([403, 404]).toContain(res.status);
      const list = await call('GET', `/api/embeds/screen-tokens?presentationId=${deck._id}`, { user: bob, workspaceId: workspaceId as string });
      expect([403, 404]).toContain(list.status);
    }
    expect(await ScreenTokenModel.countDocuments()).toBe(0);

    const { id, token } = (await createToken(deck._id)).body.data;
    // Revoking someone else's token looks exactly like a missing one, and changes nothing.
    for (const workspaceId of [wsB, wsA]) {
      const res = await call('DELETE', `/api/embeds/screen-tokens/${id}`, { user: bob, workspaceId });
      expect([403, 404]).toContain(res.status);
    }
    expect((await call('DELETE', `/api/embeds/screen-tokens/${id}`, { user: carol, workspaceId: wsA })).status).toBe(404);
    await allowEmbed(deck._id);
    expect((await stage(token)).status).toBe(200);

    expect((await call('GET', '/api/embeds/screen-tokens', { user: alice, workspaceId: wsA })).status).toBe(400);
    expect((await call('POST', '/api/embeds/screen-tokens', { user: alice, workspaceId: wsA, body: { presentationId: deck._id, label: '' } })).status).toBe(400);
    expect((await call('POST', '/api/embeds/screen-tokens', { body: { presentationId: deck._id, label: 'x' } })).status).toBe(401);
  });

  it('refuses the stage while the deck does not allow embedding, then serves a stage-safe deck', async () => {
    const deck = await createDeck([SELECT, HEADING]);
    const { token } = (await createToken(deck._id)).body.data;

    const off = await stage(token);
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('EMBED_DISABLED');

    await allowEmbed(deck._id);
    const on = await stage(token);
    expect(on.status).toBe(200);
    expect(on.headers.get('cache-control')).toBe('no-store');
    const state = on.body.data;
    expect(state.session).toBeNull();
    expect(state.presentation).toMatchObject({ _id: deck._id, title: 'Embed deck', joinCode: deck.joinCode, status: 'draft' });
    expect(state.presentation.slides).toHaveLength(2);
    expect(state.presentation.slides[0]).toMatchObject({ _id: deck.slides[0]!._id, question: 'Capital of France?', notes: '' });
    expect(state.presentation.slides[0].options.map((o: { text: string; isCorrect: boolean }) => [o.text, o.isCorrect])).toEqual([
      ['Paris', false],
      ['Lyon', false],
    ]);
    expect(JSON.stringify(state)).not.toContain('SPEAKER-NOTES-SECRET');
    // Fields a screen has no business with stay out.
    expect(state.presentation.creatorId).toBeUndefined();
    expect(state.presentation.workspaceId).toBeUndefined();

    for (const bad of ['', 'nope', `scr_${'x'.repeat(43)}`]) {
      const res = await stage(bad);
      expect(res.status).toBe(404);
    }
  });

  it('follows a live session as a screen: live counts without the answer key, the key after the reveal', async () => {
    const deck = await createDeck([SELECT]);
    await allowEmbed(deck._id);
    const { token } = (await createToken(deck._id)).body.data;
    const hostWs = await hostSocket(deck._id);
    const screen = await screenSocket(deck._id, token);
    expect(screen.ack).toEqual({ ok: true, role: 'screen' });

    expect((await host(deck._id, 'open-lobby')).status).toBe(200);
    const join = await call('POST', `/api/presentations/${deck._id}/join`, { body: { name: 'Ada' } });
    expect(join.status).toBe(200);
    const ada = join.body.data as { participantId: string; token: string };
    await waitFor(() => screen.events.some((e) => e.type === 'participant:joined'), 'screen sees the join');

    expect((await host(deck._id, 'start')).status).toBe(200);
    await waitFor(() => screen.events.some((e) => e.type === 'question:started'), 'screen sees the question');
    const answered = await call('POST', `/api/presentations/${deck._id}/answer`, {
      body: { participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, optionIndex: 0 },
    });
    expect(answered.status).toBe(200);

    await waitFor(() => screen.events.some((e) => e.type === 'answer:received'), 'screen live counts');
    await waitFor(() => hostWs.events.some((e) => e.type === 'answer:received'), 'host live counts');
    const onScreen = screen.events.find((e) => e.type === 'answer:received')!;
    const onHost = hostWs.events.find((e) => e.type === 'answer:received')!;
    expect(onScreen.payload.answeredCount).toBe(1);
    expect(onScreen.payload.distribution.counts).toEqual([1, 0]);
    expect(onScreen.payload.distribution.options).toEqual([
      { text: 'Paris', isCorrect: false },
      { text: 'Lyon', isCorrect: false },
    ]);
    expect(onHost.payload.distribution.options[0]).toEqual({ text: 'Paris', isCorrect: true });

    // The stage read agrees: counts, no key, no notes.
    const before = (await stage(token)).body.data;
    expect(before.session.status).toBe('active');
    expect(before.session.hostUserId).toBeNull();
    expect(before.answeredCount).toBe(1);
    expect(before.liveDistribution.options[0].isCorrect).toBe(false);
    expect(before.presentation.slides[0].options[0].isCorrect).toBe(false);

    // live:resync as a screen returns the same document.
    const resync = await screen.socket.timeout(3000).emitWithAck('live:resync', { presentationId: deck._id, role: 'screen', screenToken: token });
    expect(resync.ok).toBe(true);
    expect(resync.role).toBe('screen');
    expect(resync.state.presentation.slides[0].options[0].isCorrect).toBe(false);

    expect((await host(deck._id, 'reveal')).status).toBe(200);
    await waitFor(() => screen.events.some((e) => e.type === 'question:revealed'), 'screen sees the reveal');
    const revealed = screen.events.find((e) => e.type === 'question:revealed')!;
    expect(revealed.payload.distribution.options[0]).toEqual({ text: 'Paris', isCorrect: true });
    const after = (await stage(token)).body.data;
    expect(after.presentation.slides[0].options[0]).toMatchObject({ text: 'Paris', isCorrect: true });
    expect(after.distributions[deck.slides[0]!._id].distribution.options[0].isCorrect).toBe(true);

    // A screen can never answer.
    const ack = await screen.socket.timeout(3000).emitWithAck('answer:submit', {
      presentationId: deck._id,
      participantId: ada.participantId,
      participantToken: ada.token,
      slideIndex: 0,
      optionIndex: 1,
    });
    expect(ack).toMatchObject({ success: false, status: 403, code: 'NOT_JOINED' });
  });

  it('refuses screen joins with a wrong token, for another deck, or while embedding is off', async () => {
    const deck = await createDeck();
    const other = await createDeck();
    const { token } = (await createToken(deck._id)).body.data;

    expect((await screenSocket(deck._id, token)).ack).toEqual({ ok: false, error: 'FORBIDDEN' });
    await allowEmbed(deck._id);
    await allowEmbed(other._id);
    expect((await screenSocket(other._id, token)).ack).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await screenSocket(deck._id, `scr_${'y'.repeat(43)}`)).ack).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await screenSocket(deck._id, '')).ack).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    const resync = await (await screenSocket(deck._id, token)).socket
      .timeout(3000)
      .emitWithAck('live:resync', { presentationId: other._id, role: 'screen', screenToken: token });
    expect(resync).toEqual({ ok: false, error: 'FORBIDDEN' });
  });

  it('revokes a token: its connected screen leaves the deck at once and the stage stops answering', async () => {
    const deck = await createDeck([SELECT, HEADING]);
    await allowEmbed(deck._id);
    const { token, id } = (await createToken(deck._id)).body.data;
    const keep = (await createToken(deck._id, alice, wsA, 'Lobby screen')).body.data;
    const screen = await screenSocket(deck._id, token);
    const kept = await screenSocket(deck._id, keep.token);
    expect(screen.ack).toEqual({ ok: true, role: 'screen' });

    const revoked = await call('DELETE', `/api/embeds/screen-tokens/${id}`, { user: alice, workspaceId: wsA });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data).toEqual({ id, revoked: true });
    await waitFor(() => screen.revoked.length === 1, 'screen:revoked');
    expect(screen.revoked[0]).toEqual({ presentationId: deck._id, reason: 'revoked' });

    await host(deck._id, 'open-lobby');
    await waitFor(() => kept.events.some((e) => e.type === 'session:lobby'), 'the other screen still follows');
    await Bun.sleep(100);
    expect(screen.events.some((e) => e.type === 'session:lobby')).toBe(false);
    expect(kept.revoked).toHaveLength(0);

    expect((await stage(token)).status).toBe(404);
    expect((await stage(keep.token)).status).toBe(200);
    expect((await screenSocket(deck._id, token)).ack).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect((await call('DELETE', `/api/embeds/screen-tokens/${id}`, { user: alice, workspaceId: wsA })).status).toBe(404);
    const list = await call('GET', `/api/embeds/screen-tokens?presentationId=${deck._id}`, { user: alice, workspaceId: wsA });
    expect(list.body.data.map((t: { id: string }) => t.id)).toEqual([keep.id]);
  });

  it('turning embedding off sends every connected screen away at once; turning it on lets them back', async () => {
    const deck = await createDeck([SELECT, HEADING]);
    await allowEmbed(deck._id);
    const hall = (await createToken(deck._id)).body.data;
    const lobby = (await createToken(deck._id, alice, wsA, 'Lobby screen')).body.data;
    const first = await screenSocket(deck._id, hall.token);
    const second = await screenSocket(deck._id, lobby.token);
    expect(first.ack).toEqual({ ok: true, role: 'screen' });
    expect(second.ack).toEqual({ ok: true, role: 'screen' });
    // Another deck's screen is not concerned.
    const other = await createDeck();
    await allowEmbed(other._id);
    const otherToken = (await createToken(other._id)).body.data.token;
    const bystander = await screenSocket(other._id, otherToken);

    await allowEmbed(deck._id, false);
    await waitFor(() => first.revoked.length === 1 && second.revoked.length === 1, 'screen:revoked on both screens');
    expect(first.revoked[0]).toEqual({ presentationId: deck._id, reason: 'embed_disabled' });
    expect(second.revoked[0]).toEqual({ presentationId: deck._id, reason: 'embed_disabled' });
    // Refused at once, by REST and socket, for every token of the deck.
    expect((await stage(hall.token)).body.code).toBe('EMBED_DISABLED');
    expect((await stage(lobby.token)).status).toBe(403);
    expect((await screenSocket(deck._id, hall.token)).ack).toEqual({ ok: false, error: 'FORBIDDEN' });

    await host(deck._id, 'open-lobby');
    await host(other._id, 'open-lobby');
    await waitFor(() => bystander.events.some((e) => e.type === 'session:lobby'), 'the other deck still follows');
    await Bun.sleep(100);
    expect(first.events.some((e) => e.type === 'session:lobby')).toBe(false);
    expect(bystander.revoked).toHaveLength(0);

    // The tokens were not revoked: embedding back on, the same links work again.
    await allowEmbed(deck._id, true);
    expect((await stage(hall.token)).status).toBe(200);
    expect((await screenSocket(deck._id, hall.token)).ack).toEqual({ ok: true, role: 'screen' });
  });

  it('lets embedding be switched while a session is live, and nothing else', async () => {
    const deck = await createDeck([SELECT, HEADING]);
    const { token } = (await createToken(deck._id)).body.data;
    expect((await host(deck._id, 'open-lobby')).status).toBe(200);
    expect((await host(deck._id, 'start')).status).toBe(200);
    const patch = (body: unknown) => call('PATCH', `/api/presentations/${deck._id}`, { user: alice, workspaceId: wsA, body });

    const on = await patch({ settings: { embed: { allowed: true } } });
    expect(on.status).toBe(200);
    expect(on.body.data.settings.embed.allowed).toBe(true);
    // The live mirror is untouched.
    expect(on.body.data).toMatchObject({ status: 'active', currentSlideIndex: 0 });
    expect((await stage(token)).body.data.session.status).toBe('active');

    for (const body of [
      { title: 'Renamed mid-session' },
      { settings: { embed: { allowed: false }, qna: { enabled: true } } },
      { settings: { qna: { enabled: true } } },
      { settings: { embed: { allowed: false } }, title: 'x' },
    ]) {
      const res = await patch(body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }
    // Still on, and the session still runs.
    const state = await call('GET', `/api/presentations/${deck._id}/host/state`, { user: alice, workspaceId: wsA });
    expect(state.body.data.presentation.settings.embed.allowed).toBe(true);
    expect(state.body.data.session.status).toBe('active');
    expect(state.body.data.presentation.title).toBe('Embed deck');

    // A presenter (deck:host, not deck:edit) cannot switch it.
    expect((await call('PATCH', `/api/presentations/${deck._id}`, { user: carol, workspaceId: wsA, body: { settings: { embed: { allowed: false } } } })).status).toBe(403);

    const off = await patch({ settings: { embed: { allowed: false } } });
    expect(off.status).toBe(200);
    expect((await stage(token)).status).toBe(403);
  });

  it("gives a screen the session's approved and highlighted Q&A, never pending questions", async () => {
    const res = await call('POST', '/api/presentations', {
      user: alice,
      workspaceId: wsA,
      body: { title: 'Q&A deck', slides: [HEADING], settings: { qna: { enabled: true, moderation: true }, embed: { allowed: true } } },
    });
    expect(res.status).toBe(201);
    const deck = res.body.data as { _id: string };
    const { token } = (await createToken(deck._id)).body.data;
    expect((await stage(token)).body.data.qna).toBeNull();

    await host(deck._id, 'open-lobby');
    const join = async (name: string) => (await call('POST', `/api/presentations/${deck._id}/join`, { body: { name } })).body.data as { participantId: string; token: string };
    const ask = async (who: { participantId: string; token: string }, text: string) =>
      call('POST', `/api/presentations/${deck._id}/qna`, {
        headers: { 'x-participant-id': who.participantId, 'x-participant-token': who.token },
        body: { text },
      });
    const ada = await join('Ada');
    const asked = await ask(ada, 'Approved soon?');
    expect(asked.status).toBe(201);
    const approvedId = asked.body.data.id as string;
    expect((await ask(ada, 'Stays pending')).status).toBe(201);

    // Pending questions stay with the host.
    let qna = (await stage(token)).body.data.qna;
    expect(qna).toMatchObject({ questions: [], highlightedId: null, qna: { enabled: true, moderation: true } });

    const hostQna = (path: string, method: string, body: unknown) =>
      call(method, `/api/presentations/${deck._id}/host/qna${path}`, { user: alice, workspaceId: wsA, body });
    expect((await hostQna(`/${approvedId}`, 'PATCH', { status: 'visible' })).status).toBe(200);
    expect((await hostQna(`/${approvedId}/highlight`, 'POST', { highlighted: true })).status).toBe(200);

    // A screen joining now gets them at once, without waiting for a later change.
    qna = (await stage(token)).body.data.qna;
    expect(qna.highlightedId).toBe(approvedId);
    expect(qna.questions).toHaveLength(1);
    expect(qna.questions[0]).toMatchObject({ id: approvedId, text: 'Approved soon?', status: 'visible', mine: false, upvoted: false });
    expect(JSON.stringify(qna)).not.toContain('Stays pending');
    expect(JSON.stringify(qna)).not.toContain(ada.participantId);

    const screen = await screenSocket(deck._id, token);
    const resync = await screen.socket.timeout(3000).emitWithAck('live:resync', { presentationId: deck._id, role: 'screen', screenToken: token });
    expect(resync.state.qna.highlightedId).toBe(approvedId);
  });

  // ---------------------------------------------------------------------------
  // oEmbed
  // ---------------------------------------------------------------------------

  it('answers oEmbed for live, results and stage URLs of this site', async () => {
    const deck = await createDeck([SELECT]);
    await allowEmbed(deck._id);
    const site = FRONTEND();

    for (const url of [`${site}/live/${deck.joinCode}`, `${site}/embed/live/${deck.joinCode}`]) {
      const res = await oembed(url, '&format=json');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        version: '1.0',
        type: 'rich',
        provider_name: 'Open Poll',
        provider_url: site,
        title: 'Embed deck',
        width: 420,
        height: 640,
      });
      expect(res.body.html).toContain(`src="${site}/embed/live/${deck.joinCode}"`);
      expect(res.body.html).toStartWith('<iframe ');
      expect(res.body.success).toBeUndefined();
    }

    // Results: an ended session with a public link.
    await host(deck._id, 'start');
    await host(deck._id, 'end');
    const sessions = await call('GET', `/api/sessions?presentationId=${deck._id}`, { user: alice, workspaceId: wsA });
    const sessionId = sessions.body.data.items?.[0]?.sessionId ?? sessions.body.data[0]?.sessionId;
    const share = await call('POST', `/api/sessions/${sessionId}/share`, { user: alice, workspaceId: wsA, body: {} });
    expect(share.status).toBe(200);
    const resultsToken = share.body.data.token as string;
    for (const url of [`${site}/r/${resultsToken}`, `${site}/embed/results/${resultsToken}`]) {
      const res = await oembed(url, '&maxwidth=600');
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Embed deck — results');
      expect(res.body.width).toBe(600);
      expect(res.body.html).toContain(`src="${site}/embed/results/${resultsToken}"`);
    }

    // Stage: a screen token of the deck, 16:9.
    const { token } = (await createToken(deck._id)).body.data;
    const stageUrl = `${site}/embed/stage/${deck._id}?token=${token}`;
    const res = await oembed(stageUrl, '&maxwidth=640');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ width: 640, height: 360, title: 'Embed deck' });
    expect(res.body.html).toContain(`src="${site}/embed/stage/${deck._id}?token=${token}"`);
    // Any site may ask (the CORS allow-list does not apply), with no credentials.
    const cors = await server.request(`/api/oembed?url=${encodeURIComponent(stageUrl)}`, { headers: { origin: 'https://blog.example' } });
    expect(cors.status).toBe(200);
    expect(cors.headers.get('access-control-allow-origin')).toBe('*');
    expect(cors.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('refuses oEmbed for other sites, other pages, dead links, other formats and decks that do not allow embedding', async () => {
    const deck = await createDeck([SELECT]);
    const site = FRONTEND();

    // Embedding is off by default.
    const off = await oembed(`${site}/live/${deck.joinCode}`);
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('EMBED_DISABLED');

    await allowEmbed(deck._id);
    for (const url of [
      `https://evil.example/live/${deck.joinCode}`,
      `https://evil.example/embed/live/${deck.joinCode}`,
      `${site.replace('http://', 'https://')}x/live/${deck.joinCode}`,
      `${site}/presentation/host/${deck._id}`,
      `${site}/live/999999`,
      `${site}/r/${'a'.repeat(32)}`,
      `${site}/embed/stage/${deck._id}`,
      `${site}/embed/stage/${deck._id}?token=scr_${'z'.repeat(43)}`,
      `javascript:alert(1)`,
      'not a url',
    ]) {
      const res = await oembed(url);
      expect({ url, status: res.status }).toEqual({ url, status: 404 });
    }
    expect((await oembed(`${site}/live/${deck.joinCode}`, '&format=xml')).status).toBe(501);
    expect((await call('GET', '/api/oembed')).status).toBe(400);

    // A revoked token's stage is a dead link.
    const { token, id } = (await createToken(deck._id)).body.data;
    expect((await oembed(`${site}/embed/stage/${deck._id}?token=${token}`)).status).toBe(200);
    await call('DELETE', `/api/embeds/screen-tokens/${id}`, { user: alice, workspaceId: wsA });
    expect((await oembed(`${site}/embed/stage/${deck._id}?token=${token}`)).status).toBe(404);
  });

  // ---------------------------------------------------------------------------
  // Embed policy (the frontend proxy)
  // ---------------------------------------------------------------------------

  it('tells the frontend proxy whether an embed may render and which sites may frame it', async () => {
    const deck = await createDeck([SELECT]);
    const { token } = (await createToken(deck._id)).body.data;

    expect((await policy(`kind=live&id=${deck.joinCode}`)).body.data).toEqual({ allowed: false, reason: 'EMBED_DISABLED', frameAncestors: [] });
    expect((await policy(`kind=stage&id=${deck._id}&token=${token}`)).body.data.reason).toBe('EMBED_DISABLED');

    await allowEmbed(deck._id);
    expect((await policy(`kind=live&id=${deck.joinCode}`)).body.data).toEqual({ allowed: true, reason: null, frameAncestors: ['*'] });
    expect((await policy(`kind=stage&id=${deck._id}&token=${token}`)).body.data.allowed).toBe(true);
    expect((await policy(`kind=stage&id=${deck._id}`)).body.data).toEqual({ allowed: false, reason: 'NOT_FOUND', frameAncestors: [] });
    expect((await policy('kind=live&id=000000')).body.data.reason).toBe('NOT_FOUND');
    expect((await policy(`kind=results&id=${'a'.repeat(32)}`)).body.data.reason).toBe('NOT_FOUND');
    expect((await policy('kind=other&id=1')).status).toBe(400);

    // The workspace limits the sites (workspace:manage), normalised.
    const set = await call('PATCH', `/api/workspaces/${wsA}`, {
      user: alice,
      body: { settings: { embedAllowedOrigins: ['https://Intranet.example.com/', 'https://*.school.example'] } },
    });
    expect(set.status).toBe(200);
    expect(set.body.data.workspace.settings.embedAllowedOrigins).toEqual(['https://intranet.example.com', 'https://*.school.example']);
    expect((await policy(`kind=live&id=${deck.joinCode}`)).body.data.frameAncestors).toEqual([
      'https://intranet.example.com',
      'https://*.school.example',
    ]);
    expect(
      (await call('PATCH', `/api/workspaces/${wsA}`, { user: alice, body: { settings: { embedAllowedOrigins: ['https://x.example/path'] } } })).status,
    ).toBe(400);
    // A presenter may not change it.
    expect(
      (await call('PATCH', `/api/workspaces/${wsA}`, { user: carol, body: { settings: { embedAllowedOrigins: [] } } })).status,
    ).toBe(403);
    // Back to any site.
    await call('PATCH', `/api/workspaces/${wsA}`, { user: alice, body: { settings: { embedAllowedOrigins: [] } } });
    expect((await policy(`kind=live&id=${deck.joinCode}`)).body.data.frameAncestors).toEqual(['*']);
  });
});
