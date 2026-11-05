import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import type { Socket as ClientSocket } from 'socket.io-client';
import { redisClient } from '../../src/common/config/redis';
import { PresentationParticipantModel } from '../../src/modules/presentations/presentations.model';
import { PresentationAnswerModel } from '../../src/modules/presentations/models/answer.model';
import { PresentationSessionModel } from '../../src/modules/presentations/models/session.model';
import { RemoteTokenModel } from '../../src/modules/remote/remote.model';
import { hashRemoteToken } from '../../src/modules/remote/remote.service';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';

/**
 * W2-A presenter tools through the real app (createApp, Mongo, Redis, sockets):
 * removing a participant (events, refused answers and rejoin, standings),
 * pausing / resuming / extending / skipping the timer with fair speed scoring,
 * the phone remote (pairing, first-device binding, commands over its socket,
 * revocation, other workspaces), and speaker notes staying out of every
 * participant payload.
 */

type Envelope = { type: string; sessionId: string | null; audience: string; payload: Record<string, any> };
type Body<T = any> = { success: boolean; message: string; code?: string; data: T };
type Who = { participantId: string; token: string; deviceToken: string; sessionId: string };

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

const QUIZ = {
  type: 'select_answer',
  question: 'Capital of France?',
  notes: 'SECRET-NOTE-quiz: say Paris twice',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 10,
  points: 1000,
  scoreDependsOnTime: true,
};
const HEADING = {
  type: 'heading',
  content: { title: 'Welcome', subtitle: 'Hello' },
  notes: 'SECRET-NOTE-heading: smile',
};
const CLOUD = { type: 'wordcloud', question: 'One word', timeLimit: 0, notes: 'SECRET-NOTE-cloud: wait for 10 words' };
const BOARD = { type: 'leaderboard', question: 'Standings', notes: 'SECRET-NOTE-board: congratulate' };

const DEVICE_A = 'device-key-aaaaaaaaaaaaaaaaaaaaaaaa';
const DEVICE_B = 'device-key-bbbbbbbbbbbbbbbbbbbbbbbb';

describeIntegration('presenter tools (W2-A)', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(
    method: string,
    path: string,
    options: { user?: TestUser; body?: unknown; headers?: Record<string, string> } = {}
  ) => {
    const res = await server.request(path.startsWith('/api') ? path : `/api/presentations${path}`, {
      method,
      headers: { ...(options.user?.headers ?? {}), ...(options.headers ?? {}) },
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  const createDeck = async (slides: unknown[], user = host) => {
    const res = await call('POST', '/', { user, body: { title: 'Presenter deck', slides } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; joinCode: string; slides: { _id: string }[] };
  };

  const hostCommand = (pid: string, command: string, body?: unknown, user = host) =>
    call('POST', `/${pid}/host/${command}`, { user, body });

  const join = async (pid: string, name: string, deviceToken?: string) =>
    call<Who>('POST', `/${pid}/join`, { body: { name, ...(deviceToken ? { deviceToken } : {}) } });

  const answer = (pid: string, who: Who, slideIndex: number, body: Record<string, unknown>) =>
    call('POST', `/${pid}/answer`, {
      body: { participantId: who.participantId, participantToken: who.token, slideIndex, ...body },
    });

  const sockets: ClientSocket[] = [];
  const connect = async (auth?: Record<string, unknown>) => {
    const socket = server.connectSocket(auth ? { auth } : {});
    sockets.push(socket);
    await waitFor(() => socket.connected, 'socket connect');
    return socket;
  };

  /** A socket following the deck (host or participant), collecting its envelopes. */
  const follow = async (pid: string, as: { host: TestUser } | { participant: Who }) => {
    const socket = await connect('host' in as ? { token: `Bearer ${as.host.accessToken}` } : undefined);
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    const payload =
      'host' in as
        ? { presentationId: pid, role: 'host' }
        : { presentationId: pid, role: 'participant', participantId: as.participant.participantId, participantToken: as.participant.token };
    const ack = await socket.timeout(3000).emitWithAck('live:join', payload);
    return { socket, events, ack };
  };

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    while (sockets.length) sockets.pop()!.disconnect();
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host' });
  });

  afterAll(async () => {
    while (sockets.length) sockets.pop()!.disconnect();
    await resetTestData();
    await server?.close();
  });

  // -------------------------------------------------------------------------
  // Kick
  // -------------------------------------------------------------------------

  it('removes a participant: events, refused answers, reads and rejoin, standings and counts', async () => {
    const deck = await createDeck([QUIZ, BOARD]);
    const pid = deck._id;
    const lobby = await hostCommand(pid, 'open-lobby');
    const sid = lobby.body.data.session.sessionId as string;
    const ada = (await join(pid, 'Ada')).body.data;
    const troll = (await join(pid, 'Troll')).body.data;
    const hostFeed = await follow(pid, { host });
    const trollFeed = await follow(pid, { participant: troll });
    const adaFeed = await follow(pid, { participant: ada });
    expect(trollFeed.ack).toEqual({ ok: true, role: 'participant' });

    await hostCommand(pid, 'start');
    expect((await answer(pid, troll, 0, { optionIndex: 0 })).status).toBe(200);

    const kicked = await hostCommand(pid, `participants/${troll.participantId}/kick`);
    expect(kicked.status).toBe(200);
    expect(kicked.body.data).toEqual({ participantId: troll.participantId, name: 'Troll', kicked: true, participantCount: 1 });

    // The host and the removed phone hear it; the other phones do not.
    await waitFor(() => hostFeed.events.some((e) => e.type === 'participant:kicked'), 'host participant:kicked');
    await waitFor(() => trollFeed.events.some((e) => e.type === 'participant:kicked'), 'troll participant:kicked');
    expect(hostFeed.events.find((e) => e.type === 'participant:kicked')).toMatchObject({
      audience: 'host',
      sessionId: sid,
      payload: { participantId: troll.participantId, name: 'Troll', participantCount: 1 },
    });
    expect(trollFeed.events.find((e) => e.type === 'participant:kicked')?.audience).toBe(`participant:${troll.participantId}`);
    expect(adaFeed.events.some((e) => e.type === 'participant:kicked')).toBe(false);

    // Its sockets left the deck's rooms: the next slide reaches Ada, not the troll.
    await Bun.sleep(100);
    await hostCommand(pid, 'goto', { slideIndex: 1 });
    await waitFor(() => adaFeed.events.some((e) => e.type === 'leaderboard:shown'), 'ada leaderboard');
    await Bun.sleep(150);
    expect(trollFeed.events.some((e) => e.type === 'leaderboard:shown')).toBe(false);
    // ...and it cannot join them again.
    expect(await trollFeed.socket.timeout(3000).emitWithAck('live:join', {
      presentationId: pid,
      role: 'participant',
      participantId: troll.participantId,
      participantToken: troll.token,
    })).toEqual({ ok: false, error: 'FORBIDDEN' });

    // Standings and counts leave it out; its earlier answer stays counted on the slide.
    const board = adaFeed.events.find((e) => e.type === 'leaderboard:shown')!;
    expect(board.payload.leaderboard.map((e: any) => e.name)).toEqual(['Ada']);
    const state = (await call('GET', `/${pid}/host/state`, { user: host })).body.data;
    expect(state.participants.find((p: any) => p.participantId === troll.participantId)).toMatchObject({ kicked: true });
    expect(state.session.participantCount).toBe(1);
    expect(state.distributions[deck.slides[0]!._id].answeredCount).toBe(1);

    // Reads, answers and a rejoin from the same device are refused with PARTICIPANT_KICKED.
    const me = await call('GET', `/${pid}/me?participantId=${troll.participantId}&token=${troll.token}`);
    expect([me.status, me.body.code]).toEqual([403, 'PARTICIPANT_KICKED']);
    const liveState = await call('GET', `/${pid}/live-state?participantId=${troll.participantId}&token=${troll.token}`);
    expect([liveState.status, liveState.body.code]).toEqual([403, 'PARTICIPANT_KICKED']);
    const rejoin = await join(pid, 'Troll again', troll.deviceToken);
    expect([rejoin.status, rejoin.body.code]).toEqual([403, 'PARTICIPANT_KICKED']);
    await hostCommand(pid, 'goto', { slideIndex: 0 });
    await hostCommand(pid, 'reopen');
    const late = await answer(pid, troll, 0, { optionIndex: 1 });
    expect([late.status, late.body.code]).toEqual([403, 'PARTICIPANT_KICKED']);

    // Idempotent; unknown participants and other decks' participants are 404.
    expect((await hostCommand(pid, `participants/${troll.participantId}/kick`)).body.data.kicked).toBe(true);
    expect((await hostCommand(pid, 'participants/0123456789abcdef01234567/kick')).body.code).toBe('PARTICIPANT_NOT_FOUND');
    expect((await hostCommand(pid, 'participants/nope/kick')).status).toBe(404);

    // The final leaderboard and participant count skip it too.
    await hostCommand(pid, 'end');
    const ended = await PresentationSessionModel.findById(sid).lean();
    expect(ended!.finalLeaderboard.map((e) => e.name)).toEqual(['Ada']);
    expect(ended!.participantCount).toBe(1);
    expect(await PresentationParticipantModel.countDocuments({ sessionId: sid, kickedAt: { $ne: null } })).toBe(1);
  });

  it('frees a kicked participant’s seat in a capped session and refuses other workspaces', async () => {
    const other = await createVerifiedUser({ name: 'Other' });
    const deck = await createDeck([QUIZ]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const troll = (await join(pid, 'Troll')).body.data;
    const seats = `psess:{${troll.sessionId}}:seats`;
    // The free plan caps the audience, so every device holds a seat.
    expect(await redisClient.sCard(seats)).toBe(1);

    const foreign = await hostCommand(pid, `participants/${troll.participantId}/kick`, undefined, other);
    expect(foreign.status).toBe(403);
    expect((await PresentationParticipantModel.findById(troll.participantId).lean())!.kickedAt).toBeNull();

    expect((await hostCommand(pid, `participants/${troll.participantId}/kick`)).status).toBe(200);
    expect(await redisClient.sCard(seats)).toBe(0);
    // Refused before it could take a seat back.
    expect((await join(pid, 'Troll', troll.deviceToken)).body.code).toBe('PARTICIPANT_KICKED');
    expect(await redisClient.sCard(seats)).toBe(0);

    // A deck without a live session has nobody to remove.
    await hostCommand(pid, 'end');
    expect((await hostCommand(pid, `participants/${troll.participantId}/kick`)).body.code).toBe('NO_LIVE_SESSION');
  });

  // -------------------------------------------------------------------------
  // Timer
  // -------------------------------------------------------------------------

  it('pauses, resumes, extends and skips the timer; phones and stage get slide:timing; scoring leaves the pause out', async () => {
    const deck = await createDeck([QUIZ, CLOUD]);
    const pid = deck._id;
    const slideId = deck.slides[0]!._id;
    await hostCommand(pid, 'open-lobby');
    const ada = (await join(pid, 'Ada')).body.data;
    const linus = (await join(pid, 'Linus')).body.data;
    const adaFeed = await follow(pid, { participant: ada });
    const started = await hostCommand(pid, 'start');
    const sid = started.body.data.session.sessionId as string;
    const member = `${sid}|${slideId}`;
    expect(await redisClient.zScore('live:autoreveal', member)).not.toBeNull();

    await Bun.sleep(1000);
    const paused = await hostCommand(pid, 'timer', { action: 'pause' });
    expect(paused.status).toBe(200);
    const current = paused.body.data.session.current;
    expect(current).toMatchObject({ phase: 'open', endsAt: null, durationMs: 10_000 });
    expect(current.pausedRemainingMs).toBeGreaterThan(8_000);
    expect(current.pausedRemainingMs).toBeLessThanOrEqual(9_000);
    expect(paused.body.data.questionEndsAt).toBeNull();
    // A paused slide never auto-reveals.
    expect(await redisClient.zScore('live:autoreveal', member)).toBeNull();

    await waitFor(() => adaFeed.events.some((e) => e.type === 'slide:timing'), 'phone slide:timing (pause)');
    expect(adaFeed.events.find((e) => e.type === 'slide:timing')!.payload).toMatchObject({
      slideId,
      slideIndex: 0,
      action: 'pause',
      endsAt: null,
      durationMs: 10_000,
      addedSeconds: 0,
    });
    const lookup = (await call('GET', `/code/${deck.joinCode}`)).body.data;
    expect(lookup).toMatchObject({ currentSlidePhase: 'open', questionEndsAt: null, questionDurationMs: 10_000 });
    expect(lookup.questionPausedRemainingMs).toBeGreaterThan(8_000);
    const liveState = (await call('GET', `/${pid}/live-state?participantId=${ada.participantId}&token=${ada.token}`)).body.data;
    expect(liveState.current).toMatchObject({ phase: 'open', endsAt: null, durationMs: 10_000 });
    expect(liveState.current.pausedRemainingMs).toBeGreaterThan(8_000);

    // Pausing twice is refused; answers are refused while paused (after the in-flight grace).
    expect((await hostCommand(pid, 'timer', { action: 'pause' })).body.code).toBe('TIMER_STATE');
    await Bun.sleep(2000);
    const whilePaused = await answer(pid, linus, 0, { optionIndex: 0, clientAnswerId: 'linus-paused-1' });
    expect([whilePaused.status, whilePaused.body.code]).toEqual([409, 'SLIDE_PAUSED']);

    const resumed = await hostCommand(pid, 'timer', { action: 'resume' });
    expect(resumed.status).toBe(200);
    const afterResume = resumed.body.data.session.current;
    expect(afterResume.pausedRemainingMs).toBeNull();
    const endsAt = Date.parse(afterResume.endsAt);
    expect(endsAt - Date.now()).toBeGreaterThan(8_000);
    expect(await redisClient.zScore('live:autoreveal', member)).toBe(endsAt + 1500);
    expect((await hostCommand(pid, 'timer', { action: 'resume' })).body.code).toBe('TIMER_STATE');

    // The same answer, retried after the resume, counts once — and ~1 s of timer ran, not ~3 s.
    expect((await answer(pid, linus, 0, { optionIndex: 0, clientAnswerId: 'linus-paused-1' })).status).toBe(200);
    expect((await answer(pid, ada, 0, { optionIndex: 1 })).status).toBe(200);
    await settleLiveEngine();
    await waitFor(async () => (await PresentationAnswerModel.countDocuments({ sessionId: sid })) === 2, 'answers stored');
    const linusAnswer = await PresentationAnswerModel.findOne({ sessionId: sid, participantId: linus.participantId }).lean();
    expect(linusAnswer!.timeMs).toBeLessThan(1_800);
    expect(linusAnswer!.score).toBeGreaterThanOrEqual(910); // 1000 × (1 − 1.8/10/2); the 3 s wall-clock would give < 850

    // Extend adds time to the deadline and to the budget.
    const extended = await hostCommand(pid, 'timer', { action: 'extend', seconds: 30 });
    expect(Date.parse(extended.body.data.session.current.endsAt)).toBe(endsAt + 30_000);
    expect(extended.body.data.session.current.durationMs).toBe(40_000);
    await waitFor(() => adaFeed.events.some((e) => e.type === 'slide:timing' && e.payload.action === 'extend'), 'extend event');
    expect(adaFeed.events.find((e) => e.payload.action === 'extend')!.payload.addedSeconds).toBe(30);
    expect((await hostCommand(pid, 'timer', { action: 'extend', seconds: 2 })).status).toBe(400);

    // Extending while paused grows the frozen time.
    const pausedAgain = await hostCommand(pid, 'timer', { action: 'pause' });
    const frozen = pausedAgain.body.data.session.current.pausedRemainingMs as number;
    const grown = await hostCommand(pid, 'timer', { action: 'extend' });
    expect(grown.body.data.session.current.pausedRemainingMs).toBe(frozen + 30_000);

    // Skip: time's up now (also ends the pause); the timer's grace and auto-reveal follow.
    const skipped = await hostCommand(pid, 'skip');
    expect(skipped.status).toBe(200);
    expect(Math.abs(Date.parse(skipped.body.data.session.current.endsAt) - Date.now())).toBeLessThan(1_000);
    expect(skipped.body.data.session.current.pausedRemainingMs).toBeNull();
    await waitFor(() => adaFeed.events.some((e) => e.payload.action === 'skip'), 'skip event');
    const dueAt = await redisClient.zScore('live:autoreveal', member);
    expect(dueAt).not.toBeNull();
    expect(dueAt! - Date.now()).toBeLessThan(1_600);

    // Untimed slides have no timer to touch.
    await hostCommand(pid, 'goto', { slideIndex: 1 });
    const untimed = await hostCommand(pid, 'timer', { action: 'pause' });
    expect([untimed.status, untimed.body.code]).toEqual([400, 'NO_TIMER']);
    expect((await hostCommand(pid, 'skip')).body.code).toBe('NO_TIMER');
    expect((await hostCommand(pid, 'timer', { action: 'nap' })).status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Phone remote
  // -------------------------------------------------------------------------

  it('pairs a phone remote: first device binds, commands over its socket, revocation drops it', async () => {
    const deck = await createDeck([QUIZ, HEADING]);
    const pid = deck._id;
    const hostFeed = await follow(pid, { host });

    expect((await call('GET', `/${pid}/host/remote-token`, { user: host })).body.data).toEqual({
      paired: false,
      bound: false,
      boundAt: null,
      expiresAt: null,
      connected: false,
    });
    const created = await call('POST', `/${pid}/host/remote-token`, { user: host });
    expect(created.status).toBe(201);
    const { token, path } = created.body.data as { token: string; path: string };
    expect(token).toMatch(/^rt1\.[A-Za-z0-9_-]{43}$/);
    expect(path).toBe(`/remote/${token}`);
    // Hashed at rest: the token itself is nowhere in the database.
    const stored = await RemoteTokenModel.findOne({ presentationId: pid }).lean();
    expect(stored!.tokenHash).toBe(hashRemoteToken(token));
    expect(JSON.stringify(stored)).not.toContain(token.slice(4));

    // Redeeming needs a device key; the first device binds; another device is refused.
    expect((await call('GET', `/api/remote/${token}/state`)).status).toBe(400);
    const first = await call('GET', `/api/remote/${token}/state`, { headers: { 'X-Remote-Device': DEVICE_A } });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ presentationId: pid, status: 'draft', slide: null });
    const second = await call('GET', `/api/remote/${token}/state`, { headers: { 'X-Remote-Device': DEVICE_B } });
    expect([second.status, second.body.code]).toEqual([403, 'REMOTE_BOUND']);
    expect((await call('GET', `/api/remote/rt1.${'x'.repeat(43)}/state`, { headers: { 'X-Remote-Device': DEVICE_A } })).body.code).toBe('REMOTE_INVALID');
    expect((await call('GET', `/${pid}/host/remote-token`, { user: host })).body.data).toMatchObject({ paired: true, bound: true });

    // The remote's socket: device B is refused, device A joins and the host hears it.
    const remote = await connect();
    const remoteEvents: Envelope[] = [];
    remote.on('live:event', (event: Envelope) => remoteEvents.push(event));
    let revoked = false;
    remote.on('remote:revoked', () => (revoked = true));
    expect(await remote.timeout(3000).emitWithAck('remote:join', { token, deviceKey: DEVICE_B })).toEqual({ ok: false, error: 'REMOTE_BOUND' });
    expect(await remote.timeout(3000).emitWithAck('remote:command', { command: 'next' })).toEqual({ ok: false, error: 'NOT_JOINED' });
    const joined = await remote.timeout(3000).emitWithAck('remote:join', { token, deviceKey: DEVICE_A });
    expect(joined).toMatchObject({ ok: true, state: { presentationId: pid, status: 'draft' } });
    await waitFor(() => hostFeed.events.some((e) => e.type === 'remote:connected'), 'remote:connected');
    expect((await call('GET', `/${pid}/host/remote-token`, { user: host })).body.data.connected).toBe(true);

    // Commands: a session must be started from the presenter view first.
    expect(await remote.timeout(3000).emitWithAck('remote:command', { command: 'next' })).toMatchObject({ ok: false, error: 'COMMAND_FAILED' });
    expect(await remote.timeout(3000).emitWithAck('remote:command', { command: 'dance' })).toEqual({ ok: false, error: 'INVALID_PAYLOAD' });
    await hostCommand(pid, 'open-lobby');
    const ada = (await join(pid, 'Ada')).body.data;

    const next = await remote.timeout(3000).emitWithAck('remote:command', { command: 'next' });
    expect(next).toMatchObject({ ok: true, command: 'next', state: { status: 'active', currentSlideIndex: 0 } });
    expect(next.state.slide).toMatchObject({ type: 'select_answer', phase: 'open', timed: true, title: 'Capital of France?' });
    // The remote is the presenter's device: it shows the speaker notes.
    expect(next.state.slide.notes).toBe(QUIZ.notes);
    expect(next.state.next).toEqual({ slideIndex: 1, type: 'heading', title: 'Welcome' });
    await waitFor(() => remoteEvents.some((e) => e.type === 'question:started'), 'remote sees question:started');

    const pausedAck = await remote.timeout(3000).emitWithAck('remote:command', { command: 'pause' });
    expect(pausedAck.state.slide.pausedRemainingMs).toBeGreaterThan(0);
    const resumedAck = await remote.timeout(3000).emitWithAck('remote:command', { command: 'resume' });
    expect(resumedAck.state.slide.pausedRemainingMs).toBeNull();
    const extendedAck = await remote.timeout(3000).emitWithAck('remote:command', { command: 'extend30' });
    expect(extendedAck.state.slide.durationMs).toBe(40_000);
    expect((await answer(pid, ada, 0, { optionIndex: 0 })).status).toBe(200);
    const revealedAck = await remote.timeout(3000).emitWithAck('remote:command', { command: 'reveal' });
    expect(revealedAck.state.slide).toMatchObject({ phase: 'revealed', answeredCount: 1 });
    await waitFor(() => hostFeed.events.some((e) => e.type === 'question:revealed'), 'host sees the remote reveal');
    expect((await remote.timeout(3000).emitWithAck('remote:command', { command: 'close' })).ok).toBe(true); // closing a revealed slide is a no-op
    expect((await remote.timeout(3000).emitWithAck('remote:command', { command: 'next' })).state.currentSlideIndex).toBe(1);
    const atEnd = await remote.timeout(3000).emitWithAck('remote:command', { command: 'next' });
    expect(atEnd).toMatchObject({ ok: false, error: 'COMMAND_FAILED', message: 'This is the last slide' });
    expect((await remote.timeout(3000).emitWithAck('remote:command', { command: 'prev' })).state.currentSlideIndex).toBe(0);

    // Revoke: the remote is told and dropped at once, its link stops working, the host hears it.
    const revokedStatus = await call('DELETE', `/${pid}/host/remote-token`, { user: host });
    expect(revokedStatus.body.data).toMatchObject({ paired: false, connected: false });
    await waitFor(() => revoked, 'remote:revoked');
    await waitFor(() => hostFeed.events.some((e) => e.type === 'remote:disconnected'), 'remote:disconnected');
    expect(await remote.timeout(3000).emitWithAck('remote:command', { command: 'next' })).toEqual({ ok: false, error: 'NOT_JOINED' });
    expect((await call('GET', `/api/remote/${token}/state`, { headers: { 'X-Remote-Device': DEVICE_A } })).body.code).toBe('REMOTE_INVALID');
    expect(await remote.timeout(3000).emitWithAck('remote:join', { token, deviceKey: DEVICE_A })).toEqual({ ok: false, error: 'REMOTE_INVALID' });

    // A new pairing replaces the previous one.
    const again = (await call('POST', `/${pid}/host/remote-token`, { user: host })).body.data.token as string;
    const third = (await call('POST', `/${pid}/host/remote-token`, { user: host })).body.data.token as string;
    expect((await call('GET', `/api/remote/${again}/state`, { headers: { 'X-Remote-Device': DEVICE_A } })).status).toBe(404);
    expect((await call('GET', `/api/remote/${third}/state`, { headers: { 'X-Remote-Device': DEVICE_B } })).status).toBe(200);
  });

  it('keeps remotes inside their workspace: no pairing on another workspace’s deck, a pairing only drives its own deck', async () => {
    const bob = await createVerifiedUser({ name: 'Bob' });
    const aliceDeck = await createDeck([QUIZ, HEADING]);
    const bobDeck = await createDeck([QUIZ, HEADING], bob);

    // Bob cannot pair, read or revoke a remote for Alice's deck.
    expect((await call('POST', `/${aliceDeck._id}/host/remote-token`, { user: bob })).status).toBe(403);
    expect((await call('GET', `/${aliceDeck._id}/host/remote-token`, { user: bob })).status).toBe(403);
    expect((await call('DELETE', `/${aliceDeck._id}/host/remote-token`, { user: bob })).status).toBe(403);
    expect(await RemoteTokenModel.countDocuments({ presentationId: aliceDeck._id })).toBe(0);

    // Alice's live deck; Bob pairs a remote for his own deck and tries to aim it at hers.
    await hostCommand(aliceDeck._id, 'start');
    await hostCommand(bobDeck._id, 'start', undefined, bob);
    const bobToken = (await call('POST', `/${bobDeck._id}/host/remote-token`, { user: bob })).body.data.token as string;
    const remote = await connect();
    const joined = await remote.timeout(3000).emitWithAck('remote:join', { token: bobToken, deviceKey: DEVICE_A, presentationId: aliceDeck._id });
    expect(joined.state.presentationId).toBe(bobDeck._id);
    const next = await remote.timeout(3000).emitWithAck('remote:command', { command: 'next', presentationId: aliceDeck._id });
    expect(next.state).toMatchObject({ presentationId: bobDeck._id, currentSlideIndex: 1 });
    const aliceState = (await call('GET', `/${aliceDeck._id}/host/state`, { user: host })).body.data;
    expect(aliceState.session.currentSlideIndex).toBe(0);

    // A pairing whose host lost the deck (here: it moved to Alice's workspace) stops commanding it.
    const { PresentationModel } = await import('../../src/modules/presentations/models/presentation.model');
    await PresentationModel.updateOne({ _id: bobDeck._id }, { $set: { workspaceId: (await PresentationModel.findById(aliceDeck._id).lean())!.workspaceId } });
    const refused = await remote.timeout(3000).emitWithAck('remote:command', { command: 'prev' });
    expect(refused).toMatchObject({ ok: false, error: 'FORBIDDEN' });
  });

  // -------------------------------------------------------------------------
  // Profanity filter (deck setting)
  // -------------------------------------------------------------------------

  it('masks profanity in word-cloud and open answers when the deck turns the filter on, and only then', async () => {
    const OPEN = { type: 'open_ended', question: 'Thoughts?', timeLimit: 0 };
    const run = async (profanityFilter: boolean) => {
      const res = await call('POST', '/', {
        user: host,
        body: { title: 'Filtered deck', slides: [CLOUD, OPEN], settings: { profanityFilter } },
      });
      expect(res.status).toBe(201);
      const pid = res.body.data._id as string;
      await hostCommand(pid, 'open-lobby');
      const ada = (await join(pid, 'Ada')).body.data;
      await hostCommand(pid, 'start');
      expect((await answer(pid, ada, 0, { entries: ['shit', 'sunny'] })).status).toBe(200);
      await hostCommand(pid, 'reveal');
      const cloud = (await call('GET', `/${pid}/host/state`, { user: host })).body.data.liveDistribution;
      await hostCommand(pid, 'goto', { slideIndex: 1 });
      expect((await answer(pid, ada, 1, { text: 'what the fuck' })).status).toBe(200);
      await hostCommand(pid, 'reveal');
      const open = (await call('GET', `/${pid}/host/state`, { user: host })).body.data.liveDistribution;
      await settleLiveEngine();
      const stored = await PresentationAnswerModel.find({ presentationId: pid }).sort({ slideIndex: 1 }).lean();
      return { cloud, open, stored };
    };

    const filtered = await run(true);
    expect(filtered.cloud.words.map((w: any) => w.text).sort()).toEqual(['****', 'sunny']);
    expect(filtered.open.responses.map((r: any) => r.text)).toEqual(['what the ****']);
    // The raw words are not stored either.
    expect(JSON.stringify(filtered.stored)).not.toMatch(/shit|fuck/);

    const unfiltered = await run(false);
    expect(unfiltered.cloud.words.map((w: any) => w.text).sort()).toEqual(['shit', 'sunny']);
    expect(unfiltered.open.responses.map((r: any) => r.text)).toEqual(['what the fuck']);
  });

  // -------------------------------------------------------------------------
  // Speaker notes
  // -------------------------------------------------------------------------

  it('never sends speaker notes to participants (code lookup, join, live-state, me, every socket event)', async () => {
    const deck = await createDeck([HEADING, QUIZ, CLOUD, BOARD]);
    const pid = deck._id;
    const seen: unknown[] = [];

    // The host's deck carries them (the presenter view shows them).
    const hostState = (await call('GET', `/${pid}/host/state`, { user: host })).body.data;
    expect(hostState.presentation.slides.map((s: any) => s.notes)).toEqual([HEADING.notes, QUIZ.notes, CLOUD.notes, BOARD.notes]);

    await hostCommand(pid, 'open-lobby');
    seen.push((await call('GET', `/code/${deck.joinCode}`)).body);
    const joined = await join(pid, 'Ada');
    seen.push(joined.body);
    const ada = joined.body.data;
    const feed = await follow(pid, { participant: ada });

    const readAll = async () => {
      seen.push((await call('GET', `/code/${deck.joinCode}`)).body);
      seen.push((await call('GET', `/${pid}/live-state?participantId=${ada.participantId}&token=${ada.token}`)).body);
      seen.push((await call('GET', `/${pid}/me?participantId=${ada.participantId}&token=${ada.token}`)).body);
      seen.push(await feed.socket.timeout(3000).emitWithAck('live:resync', {
        presentationId: pid,
        role: 'participant',
        participantId: ada.participantId,
        participantToken: ada.token,
      }));
    };

    await hostCommand(pid, 'start'); // heading
    await readAll();
    await hostCommand(pid, 'goto', { slideIndex: 1 }); // quiz, open
    await readAll();
    expect((await answer(pid, ada, 1, { optionIndex: 0 })).status).toBe(200);
    await hostCommand(pid, 'timer', { action: 'pause' });
    await hostCommand(pid, 'timer', { action: 'resume' });
    await hostCommand(pid, 'reveal');
    await readAll();
    await hostCommand(pid, 'goto', { slideIndex: 2 }); // word cloud
    await readAll();
    await hostCommand(pid, 'close');
    await hostCommand(pid, 'goto', { slideIndex: 3 }); // leaderboard
    await readAll();
    await hostCommand(pid, 'end');
    await readAll();

    await waitFor(() => feed.events.some((e) => e.type === 'session:ended'), 'session:ended');
    seen.push(...feed.events);
    expect(feed.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['slide:shown', 'question:started', 'slide:timing', 'question:revealed', 'slide:closed', 'leaderboard:shown', 'session:ended'])
    );
    const everything = JSON.stringify(seen);
    expect(everything).not.toContain('SECRET-NOTE');
    expect(everything).not.toContain('"notes"');
  });
});
