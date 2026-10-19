import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import type { Socket as ClientSocket } from 'socket.io-client';
import { redisClient } from '../../src/common/config/redis';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { QnaQuestionModel, QnaUpvoteModel } from '../../src/modules/qna/qna.model';
import { reactionKeys, sendReaction } from '../../src/modules/reactions/reactions.service';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Q&A and reactions through the real app (createApp, Mongo, Redis, sockets):
 * participant identity from the token, moderation, the board lifecycle,
 * upvote atomicity, coalesced vote/reaction events across two instances,
 * rate limits per participant, host policy and persistence after the session.
 */

type Envelope = { type: string; sessionId: string | null; audience: string; payload: Record<string, any> };
type Body<T = any> = { success: boolean; message: string; code?: string; data: T };
type Who = { participantId: string; token: string; sessionId: string; name: string };

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
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 60,
};
const BOARD = { type: 'qna', question: 'Ask us anything' };
const OFF = { qna: { enabled: false } };
const ON = { qna: { enabled: true } };
const MODERATED = { qna: { enabled: true, moderation: true } };
const REACTIONS = { reactions: { enabled: true, emojis: ['👍', '❤️', '😂'] } };

describeIntegration('Q&A and reactions over HTTP and sockets', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(
    method: string,
    path: string,
    options: { user?: TestUser; body?: unknown; headers?: Record<string, string>; on?: TestServer } = {}
  ) => {
    const res = await (options.on ?? server).request(path, {
      method,
      headers: { ...(options.user?.headers ?? {}), ...(options.headers ?? {}) },
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  const createDeck = async (
    slides: unknown[],
    settings: Record<string, unknown> = ON,
    user = host,
    headers: Record<string, string> = {}
  ) => {
    const res = await call('POST', '/api/presentations', { user, headers, body: { title: 'Q&A deck', slides, settings } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; joinCode: string; slides: { _id: string }[]; workspaceId?: string };
  };

  const hostCommand = (pid: string, command: string, body?: unknown, user = host, headers: Record<string, string> = {}) =>
    call('POST', `/api/presentations/${pid}/host/${command}`, { user, body, headers });

  const join = async (pid: string, name: string, on: TestServer = server): Promise<Who> => {
    const res = await call('POST', `/api/presentations/${pid}/join`, { body: { name }, on });
    expect(res.status).toBe(200);
    return { ...res.body.data, name };
  };

  const asParticipant = (who: Pick<Who, 'participantId' | 'token'>): Record<string, string> => ({
    'X-Participant-Id': who.participantId,
    'X-Participant-Token': who.token,
  });

  /** A participant API call; the credentials travel as headers. */
  const qna = (
    pid: string,
    who: Pick<Who, 'participantId' | 'token'> | null,
    method: string,
    sub = '',
    body?: unknown,
    on?: TestServer
  ) => call(method, `/api/presentations/${pid}/qna${sub}`, { headers: who ? asParticipant(who) : {}, body, on });

  const ask = (pid: string, who: Who, text: string, extra: Record<string, unknown> = {}, on?: TestServer) =>
    qna(pid, who, 'POST', '', { text, ...extra }, on);

  const hostQna = (
    pid: string,
    sub = '',
    method = 'GET',
    body?: unknown,
    user: TestUser | null = host,
    headers: Record<string, string> = {}
  ) => call(method, `/api/presentations/${pid}/host/qna${sub}`, { user: user ?? undefined, body, headers });

  /** Opens the lobby, joins the named participants and starts the first slide. */
  const run = async (slides: unknown[], names: string[], settings: Record<string, unknown> = ON) => {
    const deck = await createDeck(slides, settings);
    const pid = deck._id;
    const opened = await hostCommand(pid, 'open-lobby');
    expect(opened.status).toBe(200);
    const people: Who[] = [];
    for (const name of names) people.push(await join(pid, name));
    expect((await hostCommand(pid, 'advance')).status).toBe(200);
    return { deck, pid, people, sessionId: opened.body.data.session.sessionId as string };
  };

  const follow = async (
    pid: string,
    auth: { role: 'host'; user: TestUser } | { role: 'participant'; who: Who },
    on: TestServer = server
  ) => {
    const socket = on.connectSocket(auth.role === 'host' ? { auth: { token: `Bearer ${auth.user.accessToken}` } } : {});
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    await waitFor(() => socket.connected, 'socket connect');
    const ack = await socket.timeout(3000).emitWithAck(
      'live:join',
      auth.role === 'host'
        ? { presentationId: pid, role: 'host' }
        : { presentationId: pid, role: 'participant', participantId: auth.who.participantId, participantToken: auth.who.token }
    );
    expect(ack.ok).toBe(true);
    const of = (type: string) => events.filter((e) => e.type === type);
    return { socket, events, of };
  };

  const react = (socket: ClientSocket, pid: string, who: Who, emoji: unknown, token = who.token) =>
    socket.timeout(3000).emitWithAck('reaction:send', {
      presentationId: pid,
      participantId: who.participantId,
      participantToken: token,
      emoji,
    });

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  it('needs the participant token on every participant route', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace']);
    const [ada, grace] = people as [Who, Who];
    const q = (await ask(pid, ada, 'Is it live?')).body.data;

    for (const [method, sub, body] of [
      ['GET', '', undefined],
      ['POST', '', { text: 'No token' }],
      ['POST', `/${q.id}/upvote`, undefined],
      ['DELETE', `/${q.id}/upvote`, undefined],
    ] as const) {
      const res = await qna(pid, null, method, sub, body);
      expect([res.status, res.body.code]).toEqual([401, 'PARTICIPANT_REQUIRED']);
    }
    // Only one of the two headers.
    const half = await call('GET', `/api/presentations/${pid}/qna`, { headers: { 'X-Participant-Id': ada.participantId } });
    expect([half.status, half.body.code]).toEqual([401, 'PARTICIPANT_REQUIRED']);

    // A wrong token, an unknown participant, a malformed id, another deck's participant.
    expect((await qna(pid, { participantId: ada.participantId, token: 'x'.repeat(48) }, 'GET')).status).toBe(401);
    expect((await qna(pid, { participantId: new mongoose.Types.ObjectId().toString(), token: grace.token }, 'GET')).status).toBe(404);
    expect((await qna(pid, { participantId: 'nope', token: grace.token }, 'GET')).status).toBe(404);
    expect((await qna(pid, { participantId: ada.participantId, token: grace.token }, 'GET')).status).toBe(401);
    const other = await run([SELECT], ['Alan']);
    expect((await qna(pid, other.people[0]!, 'GET')).status).toBe(404);
    expect((await qna(other.pid, ada, 'GET')).status).toBe(404);
    // Credentials in the query string are not credentials.
    const viaQuery = await call('GET', `/api/presentations/${pid}/qna?participantId=${ada.participantId}&token=${ada.token}`);
    expect(viaQuery.status).toBe(401);
  });

  it('takes the author from the token, never from the body or the query', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace']);
    const [ada, grace] = people as [Who, Who];

    for (const spoof of [{ participantId: grace.participantId }, { authorName: 'Grace' }, { status: 'visible' }, { sessionId: 'x' }]) {
      expect((await ask(pid, ada, 'Spoofed', spoof)).status).toBe(400);
    }
    expect(await QnaQuestionModel.countDocuments({})).toBe(0);

    const res = await call('POST', `/api/presentations/${pid}/qna?participantId=${grace.participantId}`, {
      headers: asParticipant(ada),
      body: { text: 'From Ada' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ authorName: 'Ada', mine: true, upvoted: false, status: 'visible' });
    const stored = await QnaQuestionModel.findById(res.body.data.id).lean();
    expect(String(stored!.participantId)).toBe(ada.participantId);
    expect(String(stored!.sessionId)).toBe(ada.sessionId);
    expect(stored!.workspaceId).toBeTruthy();
    expect(stored!.slideId).toBeNull();

    // Grace's credentials author Grace's question.
    const graces = await ask(pid, grace, 'From Grace');
    expect(graces.body.data.authorName).toBe('Grace');
    expect(String((await QnaQuestionModel.findById(graces.body.data.id).lean())!.participantId)).toBe(grace.participantId);
  });

  it('rejects empty, blank and over-long questions', async () => {
    const { pid, people } = await run([SELECT], ['Ada']);
    const [ada] = people as [Who];
    for (const text of ['', '   ', 'x'.repeat(281)]) expect((await ask(pid, ada, text)).status).toBe(400);
    expect((await ask(pid, ada, 'x'.repeat(280))).status).toBe(201);
    expect((await ask(pid, ada, '  Spaced   out \n question ')).body.data.text).toBe('Spaced out question');
  });

  it('masks profanity in stored questions', async () => {
    const { pid, people } = await run([SELECT], ['Ada']);
    const res = await ask(pid, people[0]!, 'What the fuck is a monad?');
    expect(res.body.data.text).toBe('What the **** is a monad?');
    expect((await QnaQuestionModel.findById(res.body.data.id).lean())!.text).toBe('What the **** is a monad?');
  });

  // ---------------------------------------------------------------------------
  // Visibility and moderation
  // ---------------------------------------------------------------------------

  it('shows a question to everyone at once when moderation is off', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace']);
    const [ada, grace] = people as [Who, Who];
    const hostSide = await follow(pid, { role: 'host', user: host });
    const graceSide = await follow(pid, { role: 'participant', who: grace });

    const res = await ask(pid, ada, 'Is moderation off?');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'visible', mine: true, upvoteCount: 0, pinned: false, anonymous: false });
    expect(JSON.stringify(res.body.data)).not.toContain(ada.participantId);

    await waitFor(() => hostSide.of('qna:question').length === 1 && graceSide.of('qna:question').length === 1, 'qna:question');
    for (const event of [hostSide.of('qna:question')[0]!, graceSide.of('qna:question')[0]!]) {
      expect(event.audience).toBe('all');
      expect(event.sessionId).toBe(ada.sessionId);
      expect(event.payload.question).toMatchObject({ id: res.body.data.id, text: 'Is moderation off?', authorName: 'Ada', status: 'visible' });
      expect(JSON.stringify(event)).not.toContain(ada.participantId);
    }

    const list = (await qna(pid, grace, 'GET')).body.data;
    expect(list.sessionId).toBe(ada.sessionId);
    expect(list.qna).toMatchObject({ enabled: true, moderation: false, open: true, onBoard: false, hasBoard: false });
    expect(list.questions.map((q: any) => [q.text, q.mine, q.upvoted])).toEqual([['Is moderation off?', false, false]]);
    expect(JSON.stringify(list)).not.toContain(ada.participantId);
  });

  it('holds questions for the host under moderation: pending, host-only, approved by the host', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace'], MODERATED);
    const [ada, grace] = people as [Who, Who];
    const hostSide = await follow(pid, { role: 'host', user: host });
    const adaSide = await follow(pid, { role: 'participant', who: ada });
    const graceSide = await follow(pid, { role: 'participant', who: grace });

    const asked = await ask(pid, ada, 'Will this be held?');
    expect(asked.body.data).toMatchObject({ status: 'pending', mine: true });
    const id = asked.body.data.id as string;

    await waitFor(() => hostSide.of('qna:question').length === 1, 'host sees the pending question');
    expect(hostSide.of('qna:question')[0]).toMatchObject({ audience: 'host' });
    expect(hostSide.of('qna:question')[0]!.payload.question).toMatchObject({ id, status: 'pending' });

    // The author sees it (pending); another participant does not; nothing reached their sockets.
    const own = (await qna(pid, ada, 'GET')).body.data.questions;
    expect(own.map((q: any) => [q.id, q.status, q.mine])).toEqual([[id, 'pending', true]]);
    expect((await qna(pid, grace, 'GET')).body.data.questions).toEqual([]);
    await Bun.sleep(150);
    expect(graceSide.of('qna:question')).toEqual([]);
    expect(adaSide.of('qna:question')).toEqual([]);
    // Nobody can upvote what is not visible yet.
    const early = await qna(pid, grace, 'POST', `/${id}/upvote`);
    expect([early.status, early.body.code]).toEqual([409, 'QNA_NOT_VISIBLE']);

    const pending = (await hostQna(pid, '?status=pending')).body.data;
    expect(pending.questions).toHaveLength(1);
    expect(pending.questions[0]).toMatchObject({ id, status: 'pending', participantId: ada.participantId, highlighted: false });

    const approved = await hostQna(pid, `/${id}`, 'PATCH', { status: 'visible' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ id, status: 'visible' });

    await waitFor(() => graceSide.of('qna:updated').length === 1 && adaSide.of('qna:updated').length === 1, 'qna:updated reaches everyone');
    expect(graceSide.of('qna:updated')[0]).toMatchObject({ audience: 'all' });
    expect(graceSide.of('qna:updated')[0]!.payload.question).toMatchObject({ id, status: 'visible', text: 'Will this be held?' });
    expect((await qna(pid, grace, 'GET')).body.data.questions.map((q: any) => q.id)).toEqual([id]);
  });

  it('tells only the host and the author when a pending question is rejected', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace'], MODERATED);
    const [ada, grace] = people as [Who, Who];
    const hostSide = await follow(pid, { role: 'host', user: host });
    const adaSide = await follow(pid, { role: 'participant', who: ada });
    const graceSide = await follow(pid, { role: 'participant', who: grace });

    const id = (await ask(pid, ada, 'Rejectable?')).body.data.id as string;
    expect((await hostQna(pid, `/${id}`, 'PATCH', { status: 'rejected' })).body.data.status).toBe('rejected');

    await waitFor(() => hostSide.of('qna:updated').length >= 1 && adaSide.of('qna:updated').length >= 1, 'qna:updated to host and author');
    await Bun.sleep(150);
    expect(graceSide.of('qna:updated')).toEqual([]);
    expect(adaSide.of('qna:updated')[0]!.audience).toBe(`participant:${ada.participantId}`);
    expect(adaSide.of('qna:updated')[0]!.payload.question).toMatchObject({ id, status: 'rejected' });
    // The author's list no longer shows it; the host can still filter for it.
    expect((await qna(pid, ada, 'GET')).body.data.questions).toEqual([]);
    expect((await hostQna(pid, '?status=rejected')).body.data.questions.map((q: any) => q.id)).toEqual([id]);
  });

  it('403s while Q&A is off, except while a Q&A slide is on screen (board lifecycle)', async () => {
    const { deck, pid, people } = await run([SELECT, BOARD], ['Ada', 'Grace'], OFF);
    const [ada, grace] = people as [Who, Who];

    const closed = await ask(pid, ada, 'Anyone there?');
    expect([closed.status, closed.body.code]).toEqual([403, 'QNA_DISABLED']);
    const before = (await qna(pid, ada, 'GET')).body.data;
    expect(before.qna).toMatchObject({ enabled: false, open: false, onBoard: false, hasBoard: true });

    const shown = await hostCommand(pid, 'goto', { slideIndex: 1 });
    expect(shown.status).toBe(200);
    expect(shown.body.data.session.current).toMatchObject({ slideIndex: 1, phase: 'shown' });
    expect((await qna(pid, ada, 'GET')).body.data.qna).toMatchObject({ enabled: false, open: true, onBoard: true, hasBoard: true });

    const res = await ask(pid, ada, 'Now it is open');
    expect(res.status).toBe(201);
    expect(res.body.data.slideId).toBe(deck.slides[1]!._id);
    const id = res.body.data.id as string;
    expect((await qna(pid, grace, 'POST', `/${id}/upvote`)).status).toBe(200);

    // Back to the quiz slide: closed again, but the board's questions stay readable.
    await hostCommand(pid, 'goto', { slideIndex: 0 });
    const again = await ask(pid, ada, 'Too late?');
    expect([again.status, again.body.code]).toEqual([403, 'QNA_DISABLED']);
    expect((await qna(pid, grace, 'DELETE', `/${id}/upvote`)).body.code).toBe('QNA_DISABLED');
    expect((await qna(pid, grace, 'GET')).body.data.questions.map((q: any) => q.id)).toEqual([id]);
  });

  it('respects anonymousAllowed and never exposes who asked anonymously', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace'], { qna: { enabled: true, anonymousAllowed: true } });
    const [ada, grace] = people as [Who, Who];
    const hostSide = await follow(pid, { role: 'host', user: host });
    const graceSide = await follow(pid, { role: 'participant', who: grace });

    const res = await ask(pid, ada, 'Can I stay anonymous?', { anonymous: true });
    expect(res.body.data).toMatchObject({ anonymous: true, authorName: null });
    await waitFor(() => graceSide.of('qna:question').length === 1 && hostSide.of('qna:question').length === 1, 'qna:question');

    const seenByOthers = JSON.stringify([(await qna(pid, grace, 'GET')).body, graceSide.events, hostSide.events, res.body]);
    expect(seenByOthers).not.toContain(ada.participantId);
    expect(seenByOthers).not.toContain('"Ada"');
    // The host list keeps the author away too: moderation judges text, not people.
    const listed = (await hostQna(pid)).body.data.questions[0];
    expect(listed).toMatchObject({ anonymous: true, authorName: null, participantId: null });
    // Named questions give the host the participant id.
    await ask(pid, ada, 'Named');
    const named = (await hostQna(pid)).body.data.questions.find((q: any) => q.text === 'Named');
    expect(named).toMatchObject({ authorName: 'Ada', participantId: ada.participantId });
  });

  it('refuses anonymous questions when the deck does not allow them', async () => {
    const { pid, people } = await run([SELECT], ['Ada'], { qna: { enabled: true, anonymousAllowed: false } });
    const res = await ask(pid, people[0]!, 'Hidden?', { anonymous: true });
    expect([res.status, res.body.code]).toEqual([403, 'QNA_ANONYMOUS_DISABLED']);
    expect((await ask(pid, people[0]!, 'Named is fine')).status).toBe(201);
    expect(await QnaQuestionModel.countDocuments({})).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Upvotes
  // ---------------------------------------------------------------------------

  it('allows one upvote per participant, none on your own question, and removal', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace', 'Linus']);
    const [ada, grace, linus] = people as [Who, Who, Who];
    const id = (await ask(pid, ada, 'Upvote me')).body.data.id as string;

    const own = await qna(pid, ada, 'POST', `/${id}/upvote`);
    expect([own.status, own.body.code]).toEqual([403, 'QNA_OWN_QUESTION']);

    const first = await qna(pid, grace, 'POST', `/${id}/upvote`);
    expect(first.body.data).toEqual({ questionId: id, upvoted: true, upvoteCount: 1 });
    // Repeating is a no-op that reports the state.
    const repeat = await qna(pid, grace, 'POST', `/${id}/upvote`);
    expect(repeat.body.data).toEqual({ questionId: id, upvoted: true, upvoteCount: 1 });
    expect((await qna(pid, linus, 'POST', `/${id}/upvote`)).body.data.upvoteCount).toBe(2);

    const listed = (await qna(pid, grace, 'GET')).body.data.questions[0];
    expect(listed).toMatchObject({ id, upvoteCount: 2, upvoted: true, mine: false });
    expect((await qna(pid, ada, 'GET')).body.data.questions[0]).toMatchObject({ upvoted: false, mine: true });

    const removed = await qna(pid, grace, 'DELETE', `/${id}/upvote`);
    expect(removed.body.data).toEqual({ questionId: id, upvoted: false, upvoteCount: 1 });
    expect((await qna(pid, grace, 'DELETE', `/${id}/upvote`)).body.data).toEqual({ questionId: id, upvoted: false, upvoteCount: 1 });
    expect(await QnaUpvoteModel.countDocuments({ questionId: id })).toBe(1);
    expect((await QnaQuestionModel.findById(id).lean())!.upvoteCount).toBe(1);
  });

  it('answers 404 for questions that do not exist or belong to another deck', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace']);
    const other = await run([SELECT], ['Alan']);
    const foreign = (await ask(other.pid, other.people[0]!, 'Elsewhere')).body.data.id as string;
    for (const id of [new mongoose.Types.ObjectId().toString(), 'nope', foreign]) {
      expect((await qna(pid, people[1]!, 'POST', `/${id}/upvote`)).status).toBe(404);
      expect((await qna(pid, people[1]!, 'DELETE', `/${id}/upvote`)).status).toBe(404);
    }
  });

  it('turns upvotes off per deck', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace'], { qna: { enabled: true, upvotes: false } });
    const id = (await ask(pid, people[0]!, 'No votes here')).body.data.id as string;
    const res = await qna(pid, people[1]!, 'POST', `/${id}/upvote`);
    expect([res.status, res.body.code]).toEqual([403, 'QNA_UPVOTES_DISABLED']);
    expect(await QnaUpvoteModel.countDocuments({})).toBe(0);
  });

  it('refuses upvotes on pending, rejected and archived questions', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace'], MODERATED);
    const [ada, grace] = people as [Who, Who];
    const ids: string[] = [];
    for (const text of ['one', 'two', 'three']) ids.push((await ask(pid, ada, text)).body.data.id);
    const code = async (id: string) => (await qna(pid, grace, 'POST', `/${id}/upvote`)).body.code;
    expect(await code(ids[0]!)).toBe('QNA_NOT_VISIBLE');
    await hostQna(pid, `/${ids[0]}`, 'PATCH', { status: 'rejected' });
    expect(await code(ids[0]!)).toBe('QNA_NOT_VISIBLE');
    await hostQna(pid, `/${ids[1]}`, 'PATCH', { status: 'visible' });
    expect((await qna(pid, grace, 'POST', `/${ids[1]}/upvote`)).status).toBe(200);
    await hostQna(pid, `/${ids[1]}`, 'PATCH', { status: 'archived' });
    expect(await code(ids[1]!)).toBe('QNA_NOT_VISIBLE');
    // Answered questions stay votable.
    await hostQna(pid, `/${ids[2]}`, 'PATCH', { status: 'answered' });
    expect((await qna(pid, grace, 'POST', `/${ids[2]}/upvote`)).status).toBe(200);
  });

  it('counts one upvote when the same participant clicks twenty times at once', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace']);
    const [ada, grace] = people as [Who, Who];
    const id = (await ask(pid, ada, 'Hammered')).body.data.id as string;

    const results = await Promise.all(Array.from({ length: 20 }, () => qna(pid, grace, 'POST', `/${id}/upvote`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.data.upvoteCount))).toEqual(new Set([1]));
    expect(await QnaUpvoteModel.countDocuments({ questionId: id })).toBe(1);
    expect((await QnaQuestionModel.findById(id).lean())!.upvoteCount).toBe(1);

    // Mixed upvote/removal storms keep the counter equal to the number of upvote documents.
    await Promise.all(Array.from({ length: 24 }, (_, i) => qna(pid, grace, i % 3 === 0 ? 'DELETE' : 'POST', `/${id}/upvote`)));
    const docs = await QnaUpvoteModel.countDocuments({ questionId: id });
    expect(docs).toBeLessThanOrEqual(1);
    expect((await QnaQuestionModel.findById(id).lean())!.upvoteCount).toBe(docs);
  });

  it('counts thirty distinct participants upvoting concurrently as thirty', async () => {
    const { pid, people } = await run([SELECT], ['Asker', ...Array.from({ length: 30 }, (_, i) => `Voter ${i}`)]);
    const [asker, ...voters] = people as [Who, ...Who[]];
    const id = (await ask(pid, asker, 'Popular question')).body.data.id as string;

    const results = await Promise.all(voters.map((voter) => qna(pid, voter, 'POST', `/${id}/upvote`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await QnaUpvoteModel.countDocuments({ questionId: id })).toBe(30);
    expect((await QnaQuestionModel.findById(id).lean())!.upvoteCount).toBe(30);
    expect((await qna(pid, asker, 'GET')).body.data.questions[0].upvoteCount).toBe(30);
    // The unique index is what makes this safe.
    const indexes = await QnaUpvoteModel.collection.indexes();
    expect(indexes.some((index) => index.unique && JSON.stringify(index.key) === JSON.stringify({ questionId: 1, participantId: 1 }))).toBe(true);
  });

  it('coalesces qna:votes: far fewer events than upvotes, the last one has the final count, across two instances', async () => {
    const second = await startTestServer();
    try {
      const { pid, people } = await run([SELECT], ['Asker', ...Array.from({ length: 24 }, (_, i) => `Voter ${i}`)]);
      const [asker, ...voters] = people as [Who, ...Who[]];
      const id = (await ask(pid, asker, 'Voted on twice over')).body.data.id as string;
      const hostSide = await follow(pid, { role: 'host', user: host }, second);
      const voterSide = await follow(pid, { role: 'participant', who: voters[0]! }, server);

      await Promise.all(voters.map((voter, i) => qna(pid, voter, 'POST', `/${id}/upvote`, undefined, i % 2 ? second : server)));
      await waitFor(
        () => hostSide.of('qna:votes').some((e) => e.payload.votes.some((v: any) => v.id === id && v.upvoteCount === 24)),
        'final qna:votes'
      );
      await Bun.sleep(700);
      const votes = hostSide.of('qna:votes');
      expect(votes.length).toBeGreaterThanOrEqual(1);
      expect(votes.length).toBeLessThanOrEqual(6);
      expect(votes.every((e) => e.audience === 'all' && e.sessionId === asker.sessionId)).toBe(true);
      const last = votes[votes.length - 1]!.payload.votes.find((v: any) => v.id === id);
      expect(last.upvoteCount).toBe(24);
      // Participants hear the counts too; nobody gets per-vote events.
      expect(voterSide.of('qna:votes').length).toBe(votes.length);
      // Nothing is left pending once flushed.
      expect(await redisClient.sCard(`qna:{${asker.sessionId}}:votes:dirty`)).toBe(0);
    } finally {
      await second.close();
    }
  }, 30_000);

  // ---------------------------------------------------------------------------
  // Host moderation
  // ---------------------------------------------------------------------------

  it('applies authentication and the workspace policy to host routes', async () => {
    const { deck, pid, people } = await run([SELECT], ['Ada']);
    const id = (await ask(pid, people[0]!, 'Who may moderate?')).body.data.id as string;
    const other = await createVerifiedUser({ name: 'Other' });

    // No account, or only a participant token: 401.
    expect((await hostQna(pid, '', 'GET', undefined, null)).status).toBe(401);
    const asPlayer = await call('GET', `/api/presentations/${pid}/host/qna`, { headers: asParticipant(people[0]!) });
    expect(asPlayer.status).toBe(401);
    // Another user's deck.
    for (const [method, sub, body] of [
      ['GET', '', undefined],
      ['PATCH', `/${id}`, { pinned: true }],
      ['POST', `/${id}/highlight`, {}],
    ] as const) {
      expect((await hostQna(pid, sub, method, body, other)).status).toBe(403);
    }
    expect(await QnaQuestionModel.findById(id).lean()).toMatchObject({ pinned: false, highlightedAt: null });
    // A workspace the caller does not belong to.
    const foreign = await hostQna(pid, '', 'GET', undefined, host, { 'X-Workspace-Id': new mongoose.Types.ObjectId().toString() });
    expect([foreign.status, foreign.body.code]).toEqual([403, 'WORKSPACE_FORBIDDEN']);
    expect((await hostQna(new mongoose.Types.ObjectId().toString())).status).toBe(404);
    expect((await hostQna('nope')).status).toBe(404);

    // A team deck: presenters host, viewers do not, and the team context is required.
    const viewer = await createVerifiedUser({ name: 'Viewer' });
    const team = await WorkspaceModel.create({
      name: 'Team',
      slug: `team-${new mongoose.Types.ObjectId()}`,
      type: 'team',
      ownerId: host.id,
    });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: host.id, role: 'owner' });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: other.id, role: 'presenter' });
    await WorkspaceMemberModel.create({ workspaceId: team._id, userId: viewer.id, role: 'viewer' });
    const inTeam = { 'X-Workspace-Id': String(team._id) };
    const teamDeck = await createDeck([SELECT], ON, host, inTeam);
    expect(teamDeck.workspaceId).toBe(String(team._id));
    expect((await hostQna(teamDeck._id, '', 'GET', undefined, other, inTeam)).status).toBe(200);
    expect((await hostQna(teamDeck._id, '', 'GET', undefined, viewer, inTeam)).status).toBe(403);
    expect((await hostQna(teamDeck._id, '', 'GET', undefined, other)).status).toBe(403);
    expect(deck.workspaceId).not.toBe(teamDeck.workspaceId);
  });

  it('lists by status and moderates: approve, answer, archive, pin', async () => {
    const { pid, people } = await run([SELECT], ['A', 'B', 'C', 'D'], MODERATED);
    const ids: Record<string, string> = {};
    for (const who of people) ids[who.name] = (await ask(pid, who, `Question from ${who.name}`)).body.data.id;
    const statusOf = async (status?: string) =>
      (await hostQna(pid, status ? `?status=${status}` : '')).body.data.questions.map((q: any) => q.text.slice(-1)).sort();

    expect(await statusOf()).toEqual(['A', 'B', 'C', 'D']);
    expect(await statusOf('pending')).toEqual(['A', 'B', 'C', 'D']);
    expect(await statusOf('all')).toEqual(['A', 'B', 'C', 'D']);
    expect((await hostQna(pid, '?status=bogus')).status).toBe(400);

    expect((await hostQna(pid, `/${ids.A}`, 'PATCH', { status: 'visible' })).body.data).toMatchObject({ status: 'visible', pinned: false });
    expect((await hostQna(pid, `/${ids.B}`, 'PATCH', { status: 'visible' })).status).toBe(200);
    const answered = (await hostQna(pid, `/${ids.B}`, 'PATCH', { status: 'answered' })).body.data;
    expect(answered.status).toBe('answered');
    expect(typeof answered.answeredAt).toBe('string');
    expect((await hostQna(pid, `/${ids.C}`, 'PATCH', { status: 'archived' })).body.data.status).toBe('archived');
    const pinned = (await hostQna(pid, `/${ids.A}`, 'PATCH', { pinned: true })).body.data;
    expect(pinned).toMatchObject({ status: 'visible', pinned: true });

    expect(await statusOf('pending')).toEqual(['D']);
    expect(await statusOf('visible')).toEqual(['A']);
    expect(await statusOf('answered')).toEqual(['B']);
    expect(await statusOf('archived')).toEqual(['C']);
    expect(await statusOf('rejected')).toEqual([]);

    // Un-answering clears the timestamp; patching the same value changes nothing.
    expect((await hostQna(pid, `/${ids.B}`, 'PATCH', { status: 'visible' })).body.data.answeredAt).toBeNull();
    expect((await hostQna(pid, `/${ids.A}`, 'PATCH', { pinned: true })).status).toBe(200);

    // Bad patches.
    for (const body of [{}, { status: 'pending' }, { status: 'nope' }, { text: 'edited' }, { pinned: 'yes' }]) {
      expect((await hostQna(pid, `/${ids.A}`, 'PATCH', body)).status).toBe(400);
    }
    expect((await hostQna(pid, `/${new mongoose.Types.ObjectId()}`, 'PATCH', { pinned: true })).status).toBe(404);
    expect((await hostQna(pid, '/nope', 'PATCH', { pinned: true })).status).toBe(404);

    // Pinned questions lead the participant list.
    const list = (await qna(pid, people[3]!, 'GET')).body.data.questions;
    expect(list[0]).toMatchObject({ id: ids.A, pinned: true });
  });

  it('highlights one question at a time and announces it', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace'], MODERATED);
    const [ada, grace] = people as [Who, Who];
    const hostSide = await follow(pid, { role: 'host', user: host });
    const graceSide = await follow(pid, { role: 'participant', who: grace });
    const a = (await ask(pid, ada, 'First')).body.data.id as string;
    const b = (await ask(pid, ada, 'Second')).body.data.id as string;
    const pendingOne = (await ask(pid, ada, 'Still pending')).body.data.id as string;
    for (const id of [a, b]) await hostQna(pid, `/${id}`, 'PATCH', { status: 'visible' });

    // A pending question cannot go on screen.
    const early = await hostQna(pid, `/${pendingOne}/highlight`, 'POST', {});
    expect([early.status, early.body.code]).toEqual([409, 'QNA_NOT_VISIBLE']);

    const first = await hostQna(pid, `/${a}/highlight`, 'POST', {});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ id: a, highlighted: true });
    await waitFor(() => graceSide.of('qna:highlight').length === 1, 'qna:highlight');
    expect(graceSide.of('qna:highlight')[0]!.payload.question).toMatchObject({ id: a, text: 'First' });
    expect(hostSide.of('qna:highlight')[0]).toMatchObject({ audience: 'all' });

    // Highlighting another one replaces it.
    await hostQna(pid, `/${b}/highlight`, 'POST'); // no body: highlights
    await waitFor(() => graceSide.of('qna:highlight').length === 2, 'second qna:highlight');
    expect(graceSide.of('qna:highlight')[1]!.payload.question).toMatchObject({ id: b });
    const list = (await hostQna(pid, '?status=visible')).body.data;
    expect(list.highlightedId).toBe(b);
    expect(list.questions.filter((q: any) => q.highlighted).map((q: any) => q.id)).toEqual([b]);
    expect(await QnaQuestionModel.countDocuments({ highlightedAt: { $ne: null } })).toBe(1);
    expect((await qna(pid, grace, 'GET')).body.data.highlightedId).toBe(b);

    // Taking it down publishes `question: null`.
    expect((await hostQna(pid, `/${b}/highlight`, 'POST', { highlighted: false })).body.data.highlighted).toBe(false);
    await waitFor(() => graceSide.of('qna:highlight').length === 3, 'cleared qna:highlight');
    expect(graceSide.of('qna:highlight')[2]!.payload.question).toBeNull();
    expect((await qna(pid, grace, 'GET')).body.data.highlightedId).toBeNull();

    // Archiving the highlighted question takes it off the stage as well.
    await hostQna(pid, `/${a}/highlight`, 'POST', {});
    await waitFor(() => graceSide.of('qna:highlight').length === 4, 'highlight again');
    await hostQna(pid, `/${a}`, 'PATCH', { status: 'archived' });
    await waitFor(() => graceSide.of('qna:highlight').length === 5, 'highlight cleared by archiving');
    expect(graceSide.of('qna:highlight')[4]!.payload.question).toBeNull();
    expect((await hostQna(pid)).body.data.highlightedId).toBeNull();
    expect((await hostQna(pid, `/${a}/highlight`, 'POST', {})).status).toBe(409);
    expect((await hostQna(pid, `/${a}/highlight`, 'POST', { highlighted: 'yes' })).status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Limits
  // ---------------------------------------------------------------------------

  it('limits asking per participant, not per IP', async () => {
    const { pid, people } = await run([SELECT], ['Ada', 'Grace']);
    const [ada, grace] = people as [Who, Who];
    for (let i = 0; i < 5; i++) expect((await ask(pid, ada, `Question ${i}`)).status).toBe(201);
    const sixth = await ask(pid, ada, 'One too many');
    expect(sixth.status).toBe(429);
    // Everyone here shares one IP; Grace is unaffected.
    expect((await ask(pid, grace, 'Grace asks')).status).toBe(201);
    expect(await QnaQuestionModel.countDocuments({})).toBe(6);
  });

  // ---------------------------------------------------------------------------
  // After the session
  // ---------------------------------------------------------------------------

  it('keeps questions after the session ends and keeps sessions apart', async () => {
    const { pid, people, sessionId } = await run([SELECT], ['Ada', 'Grace']);
    const [ada, grace] = people as [Who, Who];
    const id = (await ask(pid, ada, 'Before the end')).body.data.id as string;
    await qna(pid, grace, 'POST', `/${id}/upvote`);

    expect((await hostCommand(pid, 'end')).status).toBe(200);
    const stored = await QnaQuestionModel.findById(id).lean();
    expect(stored).toMatchObject({ text: 'Before the end', upvoteCount: 1 });
    expect(String(stored!.sessionId)).toBe(sessionId);
    expect(await QnaUpvoteModel.countDocuments({ questionId: id })).toBe(1);

    // The host still reads the finished session's questions; participants can read but not write.
    const afterEnd = (await hostQna(pid)).body.data;
    expect(afterEnd.sessionId).toBe(sessionId);
    expect(afterEnd.qna.open).toBe(false);
    expect(afterEnd.questions.map((q: any) => q.id)).toEqual([id]);
    const mine = (await qna(pid, grace, 'GET')).body.data;
    expect(mine.qna.open).toBe(false);
    expect(mine.questions.map((q: any) => q.id)).toEqual([id]);
    expect((await ask(pid, ada, 'Too late')).body.code).toBe('PARTICIPANT_STALE');
    expect((await qna(pid, grace, 'DELETE', `/${id}/upvote`)).body.code).toBe('PARTICIPANT_STALE');
    // Moderation keeps working on the record.
    expect((await hostQna(pid, `/${id}`, 'PATCH', { status: 'answered' })).status).toBe(200);

    // A second run starts empty and does not mix sessions.
    const run2 = await hostCommand(pid, 'open-lobby');
    const sessionId2 = run2.body.data.session.sessionId as string;
    expect(sessionId2).not.toBe(sessionId);
    const linus = await join(pid, 'Linus');
    expect((await hostQna(pid)).body.data).toMatchObject({ sessionId: sessionId2, questions: [] });
    expect((await qna(pid, linus, 'GET')).body.data.questions).toEqual([]);
    const id2 = (await ask(pid, linus, 'Second run')).body.data.id as string;
    expect((await hostQna(pid)).body.data.questions.map((q: any) => q.id)).toEqual([id2]);
    expect(await QnaQuestionModel.countDocuments({})).toBe(2);
  });

  it('returns an empty host list for a deck that never ran', async () => {
    const deck = await createDeck([SELECT], MODERATED);
    const res = await hostQna(deck._id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ sessionId: null, questions: [], highlightedId: null });
    expect(res.body.data.qna).toMatchObject({ enabled: true, moderation: true, open: false });
  });

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  it('bursts reactions to the host room, coalesced, and never to participants', async () => {
    const { pid, people } = await run([SELECT], ['A', 'B', 'C', 'D'], REACTIONS);
    const hostSide = await follow(pid, { role: 'host', user: host });
    const sides = [];
    for (const who of people) sides.push({ who, ...(await follow(pid, { role: 'participant', who })) });

    // 4 sockets x 5 sends (the per-socket limit) = 20 reactions.
    const acks = await Promise.all(
      sides.flatMap(({ who, socket }, i) =>
        Array.from({ length: 5 }, (_, n) => react(socket, pid, who, (i + n) % 5 < 3 ? '👍' : '❤️'))
      )
    );
    expect(acks.every((ack) => ack.ok === true)).toBe(true);

    const counted = () =>
      hostSide.of('reaction:burst').reduce((sum, e) => sum + Object.values<number>(e.payload.counts).reduce((a, b) => a + b, 0), 0);
    await waitFor(() => counted() === 20, 'all 20 reactions in bursts');
    await Bun.sleep(700);
    const bursts = hostSide.of('reaction:burst');
    expect(counted()).toBe(20);
    expect(bursts.length).toBeGreaterThanOrEqual(1);
    expect(bursts.length).toBeLessThanOrEqual(4);
    expect(bursts.every((e) => e.audience === 'host' && e.sessionId === people[0]!.sessionId)).toBe(true);
    const perEmoji = bursts.reduce<Record<string, number>>((sum, e) => {
      for (const [emoji, count] of Object.entries<number>(e.payload.counts)) sum[emoji] = (sum[emoji] ?? 0) + count;
      return sum;
    }, {});
    expect(Object.keys(perEmoji).sort()).toEqual(['❤️', '👍'].sort());
    expect(perEmoji['👍']! + perEmoji['❤️']!).toBe(20);
    // Participants hear nothing of it.
    for (const side of sides) expect(side.of('reaction:burst')).toEqual([]);
    expect(await redisClient.hLen(reactionKeys.pending(people[0]!.sessionId))).toBe(0);
  });

  it('checks the emoji allow-list, the token, the payload, the deck and the per-socket limit', async () => {
    const { pid, people } = await run([SELECT], ['Ada'], REACTIONS);
    const [ada] = people as [Who];
    const { socket } = await follow(pid, { role: 'participant', who: ada });

    expect(await react(socket, pid, ada, '🔥')).toEqual({ ok: false, error: 'EMOJI_NOT_ALLOWED' });
    expect(await react(socket, pid, ada, '👍', 'x'.repeat(48))).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await react(socket, pid, ada, 7)).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    // A participant of another deck cannot react on this one.
    const other = await run([SELECT], ['Alan'], REACTIONS);
    expect(await react(socket, pid, other.people[0]!, '👍')).toEqual({ ok: false, error: 'FORBIDDEN' });

    expect(await react(socket, pid, ada, '😂')).toEqual({ ok: true });
    // Five per second per socket in all (the valid sends above already used some).
    const rest = await Promise.all(Array.from({ length: 6 }, () => react(socket, pid, ada, '👍')));
    expect(rest.filter((ack) => ack.ok).length).toBeLessThanOrEqual(4);
    expect(rest.some((ack) => ack.error === 'RATE_LIMITED')).toBe(true);
  });

  it('refuses reactions when the deck has them off', async () => {
    const { pid, people } = await run([SELECT], ['Ada'], { reactions: { enabled: false } });
    const { socket } = await follow(pid, { role: 'participant', who: people[0]! });
    expect(await react(socket, pid, people[0]!, '👍')).toEqual({ ok: false, error: 'DISABLED' });
    expect((await qna(pid, people[0]!, 'GET')).body.data.reactions).toMatchObject({ enabled: false });
  });

  it('serves the reaction allow-list with the Q&A list and refuses reactions once the session ended', async () => {
    const { pid, people } = await run([SELECT], ['Ada'], REACTIONS);
    const [ada] = people as [Who];
    expect((await qna(pid, ada, 'GET')).body.data.reactions).toEqual({ enabled: true, emojis: ['👍', '❤️', '😂'] });
    const { socket } = await follow(pid, { role: 'participant', who: ada });
    expect(await react(socket, pid, ada, '👍')).toEqual({ ok: true });
    await hostCommand(pid, 'end');
    // Session settings are cached for 2 s per instance.
    await Bun.sleep(2100);
    expect(await react(socket, pid, ada, '👍')).toEqual({ ok: false, error: 'SESSION_ENDED' });
  });

  it('caps a session at 300 reactions per second, whichever socket they come from', async () => {
    const { pid, people } = await run([SELECT], ['Ada'], REACTIONS);
    const [ada] = people as [Who];
    // Put the session two reactions below the cap, then send from three separate sockets.
    await redisClient.set(reactionKeys.rate(ada.sessionId), '298', { EX: 30 });
    const acks = [];
    for (const socket of [{}, {}, {}]) {
      acks.push(
        await sendReaction(socket, { presentationId: pid, participantId: ada.participantId, participantToken: ada.token, emoji: '👍' })
      );
    }
    expect(acks).toEqual([{ ok: true }, { ok: true }, { ok: false, error: 'RATE_LIMITED' }]);
    // The refused one recorded nothing: two reactions, flushed.
    await waitFor(async () => (await redisClient.hLen(reactionKeys.pending(ada.sessionId))) === 0, 'burst flushed');
  });
});
