import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import type { Socket as ClientSocket } from 'socket.io-client';
import { redisClient } from '../../src/common/config/redis';
import {
  PresentationAnswerModel,
  PresentationParticipantModel,
  PresentationSessionModel,
} from '../../src/modules/presentations/presentations.model';
import { runAutoRevealTick } from '../../src/modules/presentations/live/autoRevealWorker';
import { k } from '../../src/modules/presentations/live/keys';
import { flushDirty } from '../../src/modules/presentations/live/coalescer';
import {
  applyParticipantIncrements,
  insertAnswerBatch,
  flushWriteBehind,
  type PendingAnswer,
} from '../../src/modules/presentations/live/writeBehind';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';

/**
 * W2-D through the real app (createApp, Mongo, Redis, sockets): the socket
 * answer path and its ack, resync over the socket, idempotent replays,
 * concurrent duplicates, auto-reveal with the real Redis schedule, and the
 * end-of-session score race on real Mongo.
 */

type Body<T = any> = { success: boolean; message: string; code?: string; data: T };
type Envelope = { type: string; sessionId: string | null; seq: number; payload: Record<string, any> };

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
const SHORT = { ...SELECT, timeLimit: 5 };
const CLOUD = { type: 'wordcloud', question: 'One word', timeLimit: 0 };

describeIntegration('live scale: socket answers, resync, replays, auto-reveal', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(method: string, path: string, options: { user?: TestUser; body?: unknown } = {}) => {
    const res = await server.request(`/api/presentations${path}`, { method, headers: options.user?.headers ?? {}, body: options.body });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };
  const createDeck = async (slides: unknown[]) => {
    const res = await call('POST', '/', { user: host, body: { title: 'Scale deck', slides } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; slides: { _id: string }[] };
  };
  const hostCommand = (pid: string, command: string) => call('POST', `/${pid}/host/${command}`, { user: host });
  const join = async (pid: string, name: string) => (await call('POST', `/${pid}/join`, { body: { name } })).body.data;
  const restAnswer = (pid: string, who: any, slideIndex: number, body: Record<string, unknown>) =>
    call('POST', `/${pid}/answer`, { body: { participantId: who.participantId, participantToken: who.token, slideIndex, ...body } });

  const connect = async (options: { user?: TestUser } = {}) => {
    const socket = server.connectSocket(options.user ? { auth: { token: `Bearer ${options.user.accessToken}` } } : {});
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    await waitFor(() => socket.connected, 'socket connect');
    return { socket, events };
  };
  const emit = (socket: ClientSocket, event: string, payload: unknown) =>
    socket.timeout(3000).emitWithAck(event, payload);

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

  it('answers over the socket with the REST result shape, stores via: socket, and replays idempotently', async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');
    await hostCommand(pid, 'advance');
    const { socket } = await connect();
    // The socket answers only as participants it joined (anyone can open a socket; the token is the identity).
    expect(await emit(socket, 'answer:submit', { presentationId: pid, participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, optionIndex: 0 })).toMatchObject({
      success: false,
      status: 403,
      code: 'NOT_JOINED',
    });
    for (const who of [ada, linus]) {
      expect(await emit(socket, 'live:join', { presentationId: pid, role: 'participant', participantId: who.participantId, participantToken: who.token })).toEqual({ ok: true, role: 'participant' });
    }

    const payload = (who: any, extra: Record<string, unknown> = {}) => ({
      presentationId: pid,
      participantId: who.participantId,
      participantToken: who.token,
      slideIndex: 0,
      optionIndex: 0,
      ...extra,
    });
    const first = await emit(socket, 'answer:submit', payload(ada, { clientAnswerId: 'ada-1' }));
    expect(first).toMatchObject({
      success: true,
      status: 200,
      message: 'Answer accepted',
      data: { accepted: true, replay: false, slideId: deck.slides[0]!._id, slideIndex: 0, clientAnswerId: 'ada-1', via: 'socket' },
    });
    // The same shape REST answers with.
    const viaRest = await restAnswer(pid, linus, 0, { optionIndex: 1, clientAnswerId: 'linus-1' });
    expect(viaRest.body).toMatchObject({ success: true, data: { accepted: true, replay: false, via: 'rest', clientAnswerId: 'linus-1' } });
    expect(Object.keys((first as any).data).sort()).toEqual(Object.keys(viaRest.body.data).sort());

    // A retry of the same answer (lost ack) over either channel returns the original.
    const replay = await emit(socket, 'answer:submit', payload(ada, { clientAnswerId: 'ada-1' }));
    expect(replay).toMatchObject({ success: true, data: { replay: true, via: 'socket', answeredAt: (first as any).data.answeredAt } });
    const restReplay = await restAnswer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1' });
    expect(restReplay.body.data).toMatchObject({ replay: true, via: 'socket' });
    // A different answer for the same slide is a duplicate.
    expect(await emit(socket, 'answer:submit', payload(ada, { optionIndex: 1, clientAnswerId: 'ada-2' }))).toMatchObject({
      success: false,
      status: 409,
      code: 'ALREADY_ANSWERED',
      data: null,
    });

    await settleLiveEngine();
    const stored = await PresentationAnswerModel.find({ presentationId: pid }).sort({ createdAt: 1 }).lean();
    expect(stored.map((a) => [a.clientAnswerId, a.via]).sort()).toEqual([
      ['ada-1', 'socket'],
      ['linus-1', 'rest'],
    ]);
    const adaDoc = await PresentationParticipantModel.findById(ada.participantId).lean();
    expect(adaDoc!.score).toBeGreaterThan(900); // counted once, not three times
  });

  it('refuses socket answers without a valid token, with a bad payload, and past the per-participant budget', async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    await hostCommand(pid, 'advance');
    const { socket } = await connect();
    expect(await emit(socket, 'live:join', { presentationId: pid, role: 'participant', participantId: ada.participantId, participantToken: ada.token })).toEqual({ ok: true, role: 'participant' });
    const base = { presentationId: pid, participantId: ada.participantId, slideIndex: 0, optionIndex: 0 };

    expect(await emit(socket, 'answer:submit', { ...base, participantToken: 'x'.repeat(48) })).toMatchObject({
      success: false,
      status: 401,
      message: 'Invalid participant token',
    });
    expect(await emit(socket, 'answer:submit', { ...base })).toMatchObject({ success: false, status: 400, code: 'INVALID_PAYLOAD' });
    expect(await emit(socket, 'answer:submit', { ...base, participantToken: ada.token, presentationId: 'nope' })).toMatchObject({
      success: false,
      status: 400,
    });
    expect(await emit(socket, 'answer:submit', null)).toMatchObject({ success: false, status: 400 });
    // Another deck's id cannot be used to answer this deck's slide.
    const otherDeck = await createDeck([SELECT]);
    expect(await emit(socket, 'answer:submit', { ...base, participantToken: ada.token, presentationId: otherDeck._id })).toMatchObject({
      success: false,
    });

    // 1 accepted + 29 duplicates use up the 30 attempts of the window; the 31st is limited.
    const results = [];
    for (let i = 0; i < 31; i += 1) results.push(await emit(socket, 'answer:submit', { ...base, participantToken: ada.token }));
    expect((results[0] as any).success).toBe(true);
    expect(results.slice(1, 30).every((r: any) => r.status === 409)).toBe(true);
    expect(results[30]).toMatchObject({ success: false, status: 429, code: 'RATE_LIMITED' });
  });

  it('limits one socket that floods answer:submit, before any Redis work', async () => {
    const { socket } = await connect();
    const replies = await Promise.all(Array.from({ length: 140 }, () => emit(socket, 'answer:submit', {})));
    expect(replies.filter((r: any) => r.status === 429).length).toBeGreaterThanOrEqual(15);
    expect(replies.filter((r: any) => r.status === 400).length).toBeGreaterThanOrEqual(100);
  });

  it('resyncs a participant and the host over the socket, with the seq to continue from', async () => {
    const deck = await createDeck([SELECT, CLOUD]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    await hostCommand(pid, 'advance');
    await restAnswer(pid, ada, 0, { optionIndex: 0 });
    const seqBefore = Number(await redisClient.get(`live:${pid}:seq`));
    expect(seqBefore).toBeGreaterThan(0);

    const participant = await connect();
    const live = (await emit(participant.socket, 'live:resync', {
      presentationId: pid,
      role: 'participant',
      participantId: ada.participantId,
      participantToken: ada.token,
    })) as any;
    expect(live).toMatchObject({
      ok: true,
      role: 'participant',
      state: {
        presentationId: pid,
        status: 'active',
        current: { slideIndex: 0, phase: 'open' },
        me: { name: 'Ada', answeredCurrent: true },
      },
    });
    expect(live.seq).toBe(seqBefore);
    expect(live.state.current.slideTicket).toMatch(/^st1\./);
    expect(JSON.stringify(live.state)).not.toContain('isCorrect"');
    expect(await emit(participant.socket, 'live:resync', { presentationId: pid, role: 'participant', participantId: ada.participantId, participantToken: 'y'.repeat(48) })).toEqual({ ok: false, error: 'UNAUTHENTICATED' });

    const hostSide = await connect({ user: host });
    const state = (await emit(hostSide.socket, 'live:resync', { presentationId: pid, role: 'host' })) as any;
    expect(state).toMatchObject({ ok: true, role: 'host', state: { session: { status: 'active', currentSlideIndex: 0 } } });
    expect(state.state.participants.map((p: any) => p.name)).toEqual(['Ada']);
    // The host read is authorized like the HTTP one.
    const outsider = await createVerifiedUser({ name: 'Outsider' });
    const intruder = await connect({ user: outsider });
    expect(await emit(intruder.socket, 'live:resync', { presentationId: pid, role: 'host' })).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(await emit(participant.socket, 'live:resync', { presentationId: pid, role: 'host' })).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    expect(await emit(participant.socket, 'live:resync', { presentationId: 'nope', role: 'host' })).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    expect(await emit(participant.socket, 'live:resync', { presentationId: pid, role: 'viewer' })).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
  });

  it('counts exactly one answer when the same participant fires many at once', async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    await hostCommand(pid, 'advance');

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => restAnswer(pid, ada, 0, { optionIndex: i % 2, clientAnswerId: `try-${i}` }))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'ALREADY_ANSWERED')).toBe(true);
    await settleLiveEngine();
    expect(await PresentationAnswerModel.countDocuments({ presentationId: pid })).toBe(1);
    const sid = String((await PresentationSessionModel.findOne({ presentationId: pid }).lean())!._id);
    expect(await redisClient.sCard(k.answered(sid, deck.slides[0]!._id))).toBe(1);
  });

  it('keeps taking ticketed answers after the timer, then auto-reveals the scored slide 1.5 s later', async () => {
    const deck = await createDeck([SHORT]);
    const pid = deck._id;
    const { socket, events } = await connect({ user: host });
    await emit(socket, 'live:join', { presentationId: pid, role: 'host' });
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');
    const started = await hostCommand(pid, 'advance');
    expect(started.status).toBe(200);
    await waitFor(() => events.some((e) => e.type === 'question:started'), 'question:started');
    const ticket = events.find((e) => e.type === 'question:started')!.payload.slideTicket as string;
    const sid = events.find((e) => e.type === 'question:started')!.sessionId!;
    expect(await redisClient.zCard('live:autoreveal')).toBeGreaterThanOrEqual(1);
    const dueAt = await redisClient.zScore('live:autoreveal', `${sid}|${deck.slides[0]!._id}`);
    expect(dueAt).not.toBeNull();

    await Bun.sleep(Math.max(0, dueAt! - 600 - Date.now())); // timer over (5 s) and its 750 ms grace, auto-reveal still ahead
    const noTicket = await restAnswer(pid, ada, 0, { optionIndex: 0 });
    expect([noTicket.status, noTicket.body.code]).toEqual([400, 'TIME_UP']);
    const withTicket = await restAnswer(pid, ada, 0, { optionIndex: 0, slideTicket: ticket });
    expect(withTicket.status).toBe(200);
    expect(await runAutoRevealTick()).toBe(0); // 1.5 s have not passed yet

    await Bun.sleep(Math.max(0, dueAt! - Date.now()) + 100);
    expect(await runAutoRevealTick()).toBe(1);
    await waitFor(() => events.some((e) => e.type === 'question:revealed'), 'question:revealed');
    expect(events.find((e) => e.type === 'question:revealed')!.payload).toMatchObject({ answeredCount: 1, slideIndex: 0 });
    const state = (await call('GET', `/${pid}/host/state`, { user: host })).body.data;
    expect(state.session.current.phase).toBe('revealed');
    expect(await runAutoRevealTick()).toBe(0); // once only
    expect((await restAnswer(pid, linus, 0, { optionIndex: 0, slideTicket: ticket })).body.code).toBe('NOT_ACCEPTING');
  }, 30_000);

  it('does not count an answer twice when its write-behind lands after the session ended (real Mongo)', async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    await hostCommand(pid, 'advance');
    await flushWriteBehind(); // nothing queued yet
    expect((await restAnswer(pid, ada, 0, { optionIndex: 0 })).status).toBe(200);
    const sid = String((await PresentationSessionModel.findOne({ presentationId: pid }).lean())!._id);
    const stored = JSON.parse((await redisClient.hGet(k.results(sid, deck.slides[0]!._id), ada.participantId))!);
    const pending: PendingAnswer = {
      presentationId: pid,
      sessionId: sid,
      participantId: ada.participantId,
      slideId: deck.slides[0]!._id,
      slideIndex: 0,
      optionIndex: stored.optionIndex,
      text: stored.text,
      payload: stored.payload,
      isCorrect: stored.isCorrect,
      score: stored.score,
      timeMs: stored.timeMs,
      clientAnswerId: stored.clientAnswerId,
      via: stored.via,
    };
    // Stop the batch the answer is queued in half way: the answer is inserted, its points not yet added.
    // (The queued copy will find the answer stored and add nothing.)
    const inserted = await insertAnswerBatch([pending]);
    expect(inserted).toHaveLength(1);
    expect(await PresentationParticipantModel.findById(ada.participantId).lean()).toMatchObject({ score: 0 });

    await hostCommand(pid, 'end');
    const total = (await PresentationParticipantModel.findById(ada.participantId).lean())!;
    expect(total.score).toBe(stored.score);
    expect(total.scoreFinalAt).toBeInstanceOf(Date);

    await applyParticipantIncrements(inserted); // the delayed increment
    await settleLiveEngine(); // and the queued batch
    expect((await PresentationParticipantModel.findById(ada.participantId).lean())!.score).toBe(stored.score);
    expect(await PresentationAnswerModel.countDocuments({ presentationId: pid })).toBe(1);
    const session = await PresentationSessionModel.findOne({ presentationId: pid }).lean();
    expect(session!.finalLeaderboard[0]).toMatchObject({ name: 'Ada', score: stored.score });
  });

  it('publishes one coalesced host update per window and drains the dirty set exactly once', async () => {
    const deck = await createDeck([SELECT]);
    const pid = deck._id;
    const hostSide = await connect({ user: host });
    await emit(hostSide.socket, 'live:join', { presentationId: pid, role: 'host' });
    await hostCommand(pid, 'open-lobby');
    const people = await Promise.all(Array.from({ length: 8 }, (_, i) => join(pid, `P${i}`)));
    await hostCommand(pid, 'advance');
    await Promise.all(people.map((who) => restAnswer(pid, who, 0, { optionIndex: 0 })));

    const sid = String((await PresentationSessionModel.findOne({ presentationId: pid }).lean())!._id);
    await waitFor(() => hostSide.events.some((e) => e.type === 'answer:received'), 'coalesced update');
    await Bun.sleep(400);
    const updates = hostSide.events.filter((e) => e.type === 'answer:received');
    expect(updates.length).toBeLessThanOrEqual(2); // 8 answers, at most one per 250 ms window
    expect(updates.at(-1)!.payload).toMatchObject({ answeredCount: 8, participantCount: 8 });
    expect(await redisClient.sCard(k.dirtySlides(sid))).toBe(0);
    expect(await flushDirty(pid, sid)).toBe(0);
  });
});

