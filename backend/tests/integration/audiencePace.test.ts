import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import type { Socket as ClientSocket } from 'socket.io-client';
import { Scheduler, registeredJobs } from '../../src/common/jobs/scheduler';
import { PresentationAnswerModel } from '../../src/modules/presentations/models/answer.model';
import { PresentationModel } from '../../src/modules/presentations/models/presentation.model';
import { PresentationParticipantModel } from '../../src/modules/presentations/models/participant.model';
import { PresentationSessionModel } from '../../src/modules/presentations/models/session.model';
import { AUDIENCE_AUTOCLOSE_JOB } from '../../src/modules/presentations/live/audienceAutoClose';
import { idleEndReason } from '../../src/modules/presentations/live/activity';
import { createPoll, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, settleLiveEngine, startTestServer, type TestServer } from './harness';

/**
 * W2-F audience pace through the real app (createApp, Mongo, Redis, sockets):
 * opening every slide at once (with and without a closing time) and closing
 * them, answers to any open slide through the normal answer path (idempotent
 * replays, socket and REST), no speed points, `resultsVisibility`, attempts with
 * pass/fail and retries up to `maxAttempts`, the `audience-autoclose` job, the
 * host dashboard data, and the refusals (presenter-paced decks and sessions,
 * templates, slide commands, other workspaces). A converted poll and a
 * converted TRIAL run end to end.
 */

type Envelope = { type: string; sessionId: string | null; audience: string; payload: Record<string, any> };
type Body<T = any> = { success: boolean; message: string; code?: string; data: T };
type Who = { participantId: string; token: string; deviceToken: string; sessionId: string; name: string };

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

const quiet = { log: () => {}, error: () => {} };

/** A published TRIAL poll: two graded questions worth 1 point each, pass at 60 %. */
const TRIAL = {
  title: 'Safety check',
  pollType: 'TRIAL',
  passingScorePercentage: 60,
  questions: [
    { text: 'Fire exit colour?', options: ['Green', 'Purple'], type: 'single', correctOptionIndices: [0], explanation: 'Exit signs are green.' },
    { text: 'Alarm test day?', options: ['Monday', 'Friday'], type: 'single', correctOptionIndices: [1] },
  ],
};

const POLL = {
  title: 'Team lunch',
  pollType: 'POLL',
  questions: [
    { text: 'Pizza or salad?', options: ['Pizza', 'Salad'], type: 'single' },
    { text: 'Which day?', options: ['Tuesday', 'Thursday'], type: 'single' },
  ],
};

describeIntegration('audience pace (W2-F)', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(method: string, path: string, options: { user?: TestUser; body?: unknown } = {}) => {
    const res = await server.request(path.startsWith('/api') ? path : `/api/presentations${path}`, {
      method,
      headers: options.user?.headers ?? {},
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  /** Converts a poll into an (audience-paced) deck and applies `settings`. */
  const convert = async (poll: Record<string, unknown>, settings?: Record<string, unknown>) => {
    const created = await createPoll(server, host, poll);
    const res = await call('POST', `/api/library/convert/poll/${created._id}`, { user: host });
    expect(res.status).toBe(201);
    const deck = res.body.data.presentation ?? res.body.data;
    if (settings) expect((await call('PATCH', `/${deck._id}`, { user: host, body: { settings } })).status).toBe(200);
    return (await call('GET', `/${deck._id}`, { user: host })).body.data as {
      _id: string;
      pace: string;
      settings: any;
      slides: { _id: string; points: number }[];
    };
  };

  const hostCommand = (pid: string, command: string, body?: unknown, user = host) =>
    call('POST', `/${pid}/host/${command}`, { user, body });

  const join = async (pid: string, name?: string) => {
    const res = await call<Who>('POST', `/${pid}/join`, { body: name === undefined ? {} : { name } });
    expect(res.status).toBe(200);
    return res.body.data;
  };

  const answer = (pid: string, who: Who, slide: { _id: string }, slideIndex: number, body: Record<string, unknown>) =>
    call('POST', `/${pid}/answer`, {
      body: {
        participantId: who.participantId,
        participantToken: who.token,
        sessionId: who.sessionId,
        slideId: slide._id,
        slideIndex,
        ...body,
      },
    });

  const liveState = async (pid: string, who: Who) =>
    (await call('GET', `/${pid}/live-state?participantId=${who.participantId}&token=${who.token}`)).body.data;

  const attemptCall = (pid: string, who: Who, action: 'submit' | 'retry', attempt?: number) =>
    call('POST', `/${pid}/audience/${action}`, {
      body: { participantId: who.participantId, participantToken: who.token, ...(attempt ? { attempt } : {}) },
    });

  const hostState = async (pid: string) => (await call('GET', `/${pid}/host/state`, { user: host })).body.data;

  const sockets: ClientSocket[] = [];
  const follow = async (pid: string, as: { host: TestUser } | { participant: Who }) => {
    const socket = server.connectSocket('host' in as ? { auth: { token: `Bearer ${as.host.accessToken}` } } : {});
    sockets.push(socket);
    await waitFor(() => socket.connected, 'socket connect');
    const events: Envelope[] = [];
    socket.on('live:event', (event: Envelope) => events.push(event));
    const payload =
      'host' in as
        ? { presentationId: pid, role: 'host' }
        : { presentationId: pid, role: 'participant', participantId: as.participant.participantId, participantToken: as.participant.token };
    expect(await socket.timeout(3000).emitWithAck('live:join', payload)).toMatchObject({ ok: true });
    return { socket, events };
  };

  beforeAll(async () => {
    server = await startTestServer();
    // Suites that rebuild the answers collection (migration 030's) may leave the
    // attempt-less unique index of migration 030 behind; this suite needs the current one.
    await PresentationAnswerModel.syncIndexes();
  }, 20_000);

  beforeEach(async () => {
    while (sockets.length) sockets.pop()!.disconnect();
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host' });
  });

  afterAll(async () => {
    while (sockets.length) sockets.pop()!.disconnect();
    await server?.close();
  });

  it('runs a converted TRIAL end to end: any slide in any order, no speed points, pass/fail, a retry up to maxAttempts', async () => {
    const deck = await convert(TRIAL, { audiencePaced: { resultsVisibility: 'after_submit', assessment: { maxAttempts: 2 } } });
    expect(deck.pace).toBe('audience');
    expect(deck.settings.audiencePaced.assessment).toMatchObject({ enabled: true, passingScorePercentage: 60, maxAttempts: 2 });
    const pid = deck._id;
    const [q1, q2] = deck.slides as [{ _id: string; points: number }, { _id: string; points: number }];

    expect((await hostCommand(pid, 'open-lobby')).status).toBe(200);
    const ada = await join(pid, 'Ada');
    const bob = await join(pid, 'Bob');
    const hostSocket = await follow(pid, { host });
    const adaSocket = await follow(pid, { participant: ada });

    // Waiting in the lobby: no slides yet, answers refused.
    expect((await liveState(pid, ada)).audience).toMatchObject({ status: 'waiting', slides: [] });
    expect((await answer(pid, ada, q1, 0, { optionIndex: 0 })).body.code).toBe('NOT_ACCEPTING');

    const closesAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const opened = await hostCommand(pid, 'open-audience', { closesAt });
    expect(opened.status).toBe(200);
    expect(opened.body.data.session).toMatchObject({ status: 'active', pace: 'audience', currentSlideIndex: -1 });
    expect(opened.body.data.session.audience).toMatchObject({ closesAt, closedAt: null });
    await waitFor(() => adaSocket.events.some((e) => e.type === 'audience:opened'), 'audience:opened on the phone');
    expect(adaSocket.events.find((e) => e.type === 'audience:opened')!.payload.closesAt).toBe(closesAt);

    const adaView = (await liveState(pid, ada)).audience;
    expect(adaView).toMatchObject({ status: 'open', attempt: { number: 1, submitted: false }, attemptsLeft: 1, canRetry: false, final: false });
    expect(adaView.slides.map((s: any) => s.phase)).toEqual(['open', 'open']);
    expect(adaView.slides.every((s: any) => typeof s.slideTicket === 'string')).toBe(true);
    // Answer keys never reach the phone before the attempt is final.
    expect(JSON.stringify(adaView)).not.toContain('isCorrect":true');
    expect(JSON.stringify(adaView)).not.toContain('Exit signs are green');

    // Ada answers the second slide first, over the socket, then the first over REST; both right.
    const socketAck = await adaSocket.socket.timeout(3000).emitWithAck('answer:submit', {
      presentationId: pid,
      participantId: ada.participantId,
      participantToken: ada.token,
      sessionId: ada.sessionId,
      slideId: q2._id,
      slideIndex: 1,
      optionIndex: 1,
      attempt: 1,
      clientAnswerId: 'ada-q2',
    });
    expect(socketAck).toMatchObject({ success: true, status: 200 });
    expect((await answer(pid, ada, q1, 0, { optionIndex: 0, attempt: 1, clientAnswerId: 'ada-q1' })).status).toBe(200);
    // A replay (lost ack, offline queue) counts nothing again.
    const replay = await answer(pid, ada, q1, 0, { optionIndex: 0, attempt: 1, clientAnswerId: 'ada-q1', offline: true });
    expect(replay.body.data).toMatchObject({ replay: true });
    expect((await answer(pid, ada, q1, 0, { optionIndex: 1, attempt: 1, clientAnswerId: 'other' })).body.code).toBe('ALREADY_ANSWERED');

    // Results after submit: shown per answered slide, but not for graded slides of an assessment before it is final.
    const answeredView = (await liveState(pid, ada)).audience;
    expect(answeredView.slides.map((s: any) => s.answered)).toEqual([true, true]);
    expect(answeredView.slides.map((s: any) => s.results)).toEqual([null, null]);
    expect(answeredView.slides[0].response).toMatchObject({ optionIndex: 0 });

    // Submit: 2 of 2 points (converted slides: 1 point each, no speed share) → passed.
    const adaSubmit = await attemptCall(pid, ada, 'submit', 1);
    expect(adaSubmit.status).toBe(200);
    expect(adaSubmit.body.data.attempts).toEqual([
      expect.objectContaining({ number: 1, score: 2, maxScore: 2, percentage: 100, correctCount: 2, answeredCount: 2, totalQuestions: 2, passed: true }),
    ]);
    expect(adaSubmit.body.data).toMatchObject({ final: true, canRetry: false, attempt: { number: 1, submitted: true } });
    expect(adaSubmit.body.data.slides.map((s: any) => s.isCorrect)).toEqual([true, true]);
    expect(adaSubmit.body.data.slides[0].explanation).toBe('Exit signs are green.');
    expect(adaSubmit.body.data.slides[0].results.distribution.counts).toEqual([1, 0]);
    // Submitting again answers the same; nothing lands in a submitted attempt; a pass needs no retry.
    expect((await attemptCall(pid, ada, 'submit', 1)).body.data.attempts).toHaveLength(1);
    expect((await attemptCall(pid, ada, 'retry')).body.code).toBe('RETRY_NOT_ALLOWED');
    await waitFor(
      () => hostSocket.events.some((e) => e.type === 'audience:progress' && e.payload.participantId === ada.participantId),
      'audience:progress on the host'
    );
    expect(adaSocket.events.some((e) => e.type === 'audience:progress')).toBe(false);

    // Bob gets one wrong: 1 of 2 = 50 % < 60 % → failed, one retry left.
    expect((await answer(pid, bob, q1, 0, { optionIndex: 0, clientAnswerId: 'bob-q1' })).status).toBe(200);
    expect((await answer(pid, bob, q2, 1, { optionIndex: 0, clientAnswerId: 'bob-q2' })).status).toBe(200);
    const bobFail = (await attemptCall(pid, bob, 'submit')).body.data;
    expect(bobFail.attempts[0]).toMatchObject({ number: 1, score: 1, percentage: 50, passed: false });
    expect(bobFail).toMatchObject({ final: false, canRetry: true, attemptsLeft: 1 });
    // Not final: no right/wrong, no explanation, no results of the graded slides yet.
    expect(bobFail.slides.map((s: any) => [s.isCorrect, s.explanation, s.results])).toEqual([
      [null, null, null],
      [null, null, null],
    ]);
    expect((await answer(pid, bob, q2, 1, { optionIndex: 1, attempt: 1, clientAnswerId: 'bob-late' })).body.code).toBe(
      'ALREADY_ANSWERED'
    );

    // The host dashboard: who is in, progress, completions, pass/fail.
    const mid = (await hostState(pid)).audience;
    expect(mid).toMatchObject({ participantCount: 2, completedCount: 2, passedCount: 1, failedCount: 1, totalQuestions: 2 });
    expect(mid.slides.map((s: any) => s.answeredCount)).toEqual([2, 2]);
    expect(mid.participants.map((p: any) => [p.name, p.attempt, p.answeredCount, p.submitted, p.lastResult?.passed])).toEqual([
      ['Ada', 1, 2, true, true],
      ['Bob', 1, 2, true, false],
    ]);

    // Retry: a fresh attempt (double click: one attempt), the leaderboard score back to 0.
    const retried = (await attemptCall(pid, bob, 'retry')).body.data;
    expect(retried).toMatchObject({ attempt: { number: 2, submitted: false }, canRetry: false, final: false, attemptsLeft: 0 });
    expect(retried.slides.map((s: any) => s.answered)).toEqual([false, false]);
    expect((await attemptCall(pid, bob, 'retry')).body.data.attempt.number).toBe(2);
    const board = (await hostState(pid)).leaderboard as { name: string; score: number }[];
    expect(board.find((e) => e.name === 'Bob')?.score).toBe(0);
    // An attempt-1 answer still sitting in the offline queue replays, and never lands in attempt 2.
    const lateReplay = await answer(pid, bob, q1, 0, { optionIndex: 0, attempt: 1, clientAnswerId: 'bob-q1', offline: true });
    expect(lateReplay.body.data).toMatchObject({ replay: true });
    expect((await answer(pid, bob, q1, 0, { optionIndex: 0, attempt: 1, clientAnswerId: 'new' })).body.code).toBe('ALREADY_ANSWERED');
    expect((await answer(pid, bob, q1, 0, { optionIndex: 0, attempt: 3, clientAnswerId: 'future' })).body.code).toBe('ATTEMPT_STALE');

    // Attempt 2, both right → passed; the attempt count is used up.
    expect((await answer(pid, bob, q1, 0, { optionIndex: 0, attempt: 2, clientAnswerId: 'bob2-q1' })).status).toBe(200);
    expect((await answer(pid, bob, q2, 1, { optionIndex: 1, attempt: 2, clientAnswerId: 'bob2-q2' })).status).toBe(200);
    const bobPass = (await attemptCall(pid, bob, 'submit', 2)).body.data;
    expect(bobPass.attempts.map((a: any) => [a.number, a.percentage, a.passed])).toEqual([
      [1, 50, false],
      [2, 100, true],
    ]);
    expect(bobPass).toMatchObject({ final: true, canRetry: false });
    // Final now: results of every attempt (3 responses to the first slide, all "Green").
    expect(bobPass.slides[0].results).toMatchObject({ answeredCount: 3, distribution: { counts: [3, 0] } });
    expect((await answer(pid, bob, q1, 0, { optionIndex: 1, attempt: 2, clientAnswerId: 'after' })).body.code).toBe('ALREADY_ANSWERED');

    // Ending reconciles: Bob's total is his latest attempt, both attempts stay on record.
    await settleLiveEngine();
    expect((await hostCommand(pid, 'end')).status).toBe(200);
    const session = await PresentationSessionModel.findById(ada.sessionId).lean();
    expect(session!.audience).toMatchObject({ closeReason: 'ended' });
    expect(session!.finalLeaderboard.map((e) => [e.name, e.score, e.correctCount])).toEqual([
      ['Ada', 2, 2],
      ['Bob', 2, 2],
    ]);
    // Responses: every attempt's answer counts (Bob answered each slide twice), as in the distribution.
    expect(session!.slideStats.map((s) => s.answeredCount)).toEqual([3, 3]);
    expect((session!.slideStats[0]!.distribution as { counts: number[] }).counts).toEqual([3, 0]);
    const bobAnswers = await PresentationAnswerModel.find({ sessionId: ada.sessionId, participantId: bob.participantId }).lean();
    expect(bobAnswers.map((a) => a.attempt).sort()).toEqual([1, 1, 2, 2]);
    const bobDoc = await PresentationParticipantModel.findById(bob.participantId).lean();
    expect(bobDoc!.audience!.attempts.map((a) => a.passed)).toEqual([false, true]);
    // After the end the phone still reads its result.
    expect((await liveState(pid, bob)).audience).toMatchObject({ status: 'closed', final: true });
  }, 30_000);

  it('scores graded slides without speed points and keeps one attempt without an assessment', async () => {
    const res = await call('POST', '/', {
      user: host,
      body: {
        title: 'Self-paced quiz',
        pace: 'audience',
        settings: { nickname: 'optional', audiencePaced: { resultsVisibility: 'after_close', closeAfterMinutes: 30 } },
        slides: [
          { type: 'heading', content: { title: 'Welcome', subtitle: '' } },
          {
            type: 'select_answer',
            question: 'Speedy?',
            options: [
              { text: 'Yes', isCorrect: true },
              { text: 'No', isCorrect: false },
            ],
            timeLimit: 5,
            points: 1000,
            scoreDependsOnTime: true,
          },
          { type: 'wordcloud', question: 'One word', timeLimit: 0 },
        ],
      },
    });
    expect(res.status).toBe(201);
    const pid = res.body.data._id as string;
    const slides = res.body.data.slides as { _id: string }[];

    // Start presenting an audience-paced deck: every slide opens at once, no lobby needed.
    const started = await hostCommand(pid, 'start');
    expect(started.status).toBe(200);
    expect(started.body.data.session).toMatchObject({ status: 'active', pace: 'audience', current: null });
    // The deck's default duration sets the closing time.
    const closesIn = Date.parse(started.body.data.session.audience.closesAt) - Date.now();
    expect(closesIn).toBeGreaterThan(29 * 60_000);
    expect(closesIn).toBeLessThanOrEqual(30 * 60_000);

    // Nickname optional: no name → "Guest NNNN".
    const guest = await join(pid);
    expect(guest.name).toMatch(/^Guest \d{4}$/);
    const view = (await liveState(pid, guest)).audience;
    expect(view.slides.map((s: any) => [s.lifecycle, s.phase])).toEqual([
      ['content', 'shown'],
      ['response', 'open'],
      ['response', 'open'],
    ]);

    // Well past the slide's own 5 s timer: still open (no timer) and full points (no speed scoring).
    await Bun.sleep(5_200);
    expect((await answer(pid, guest, slides[1]!, 1, { optionIndex: 0 })).status).toBe(200);
    expect((await answer(pid, guest, slides[2]!, 2, { payload: { entries: ['calm'] } })).status).toBe(200);
    const submitted = (await attemptCall(pid, guest, 'submit')).body.data;
    expect(submitted.attempts[0]).toMatchObject({ score: 1000, maxScore: 1000, percentage: 100, passed: null, totalQuestions: 2 });
    // No assessment: one attempt, final once submitted (right/wrong shows), no retry.
    expect(submitted).toMatchObject({ final: true, canRetry: false, attemptsLeft: 0 });
    expect(submitted.slides[1].isCorrect).toBe(true);
    expect((await attemptCall(pid, guest, 'retry')).body.code).toBe('RETRY_NOT_ALLOWED');
    // Results after close: hidden until the host closes.
    expect(submitted.slides.map((s: any) => s.results)).toEqual([null, null, null]);

    const second = await join(pid, 'Linus');
    expect((await hostCommand(pid, 'close-audience')).status).toBe(200);
    const closed = (await liveState(pid, second)).audience;
    expect(closed.status).toBe('closed');
    expect(closed.slides[1].results.distribution.counts).toEqual([1, 0]);
    expect(closed.slides[2].results.distribution).toMatchObject({ kind: 'words' });
    expect((await answer(pid, second, slides[1]!, 1, { optionIndex: 1 })).body.code).toBe('NOT_ACCEPTING');
    // Closing twice is fine; opening again lets answers in once more.
    expect((await hostCommand(pid, 'close-audience')).status).toBe(200);
    expect((await hostCommand(pid, 'open-audience')).status).toBe(200);
    expect((await answer(pid, second, slides[1]!, 1, { optionIndex: 1 })).status).toBe(200);
  }, 30_000);

  it('applies resultsVisibility: after_submit per answered slide, never at all', async () => {
    const deck = await convert(POLL, { audiencePaced: { resultsVisibility: 'after_submit' } });
    const pid = deck._id;
    const s1 = deck.slides[0]!;
    expect((await hostCommand(pid, 'open-audience')).status).toBe(200);
    const ada = await join(pid, 'Ada');
    expect((await answer(pid, ada, s1, 0, { optionIndex: 1 })).status).toBe(200);
    const view = (await liveState(pid, ada)).audience;
    // Ungraded poll slides: results right after answering; the unanswered slide shows none.
    expect(view.slides[0].results).toMatchObject({ answeredCount: 1, distribution: { counts: [0, 1] } });
    expect(view.slides[1].results).toBeNull();
    expect(view.slides[0].isCorrect).toBeNull();
    await hostCommand(pid, 'end');

    const hidden = await convert({ ...POLL, title: 'Hidden results' }, { audiencePaced: { resultsVisibility: 'never' } });
    expect((await hostCommand(hidden._id, 'open-audience')).status).toBe(200);
    const bob = await join(hidden._id, 'Bob');
    expect((await answer(hidden._id, bob, hidden.slides[0]!, 0, { optionIndex: 0 })).status).toBe(200);
    expect((await attemptCall(hidden._id, bob, 'submit')).status).toBe(200);
    expect((await hostCommand(hidden._id, 'close-audience')).status).toBe(200);
    const never = (await liveState(hidden._id, bob)).audience;
    expect(never.slides.map((s: any) => s.results)).toEqual([null, null]);
  }, 20_000);

  it('stops at maxAttempts: a failed last attempt is final', async () => {
    const deck = await convert(TRIAL, { audiencePaced: { assessment: { maxAttempts: 1 } } });
    const pid = deck._id;
    expect((await hostCommand(pid, 'open-audience')).status).toBe(200);
    const ada = await join(pid, 'Ada');
    expect((await answer(pid, ada, deck.slides[0]!, 0, { optionIndex: 1 })).status).toBe(200);
    const failed = (await attemptCall(pid, ada, 'submit')).body.data;
    expect(failed.attempts[0]).toMatchObject({ score: 0, percentage: 0, answeredCount: 1, passed: false });
    expect(failed).toMatchObject({ final: true, canRetry: false, attemptsLeft: 0 });
    // Final: right/wrong shows, an unanswered slide too (null: not answered).
    expect(failed.slides.map((s: any) => s.isCorrect)).toEqual([false, null]);
    const refused = await attemptCall(pid, ada, 'retry');
    expect(refused).toMatchObject({ status: 409, body: { code: 'RETRY_NOT_ALLOWED', message: 'No attempts left' } });
    // A submit for another attempt than the current one is refused.
    expect((await attemptCall(pid, ada, 'submit', 2)).body.code).toBe('ATTEMPT_STALE');
  }, 20_000);

  it('closes on its own at the closing time (audience-autoclose job), and the idle job leaves it open until then', async () => {
    const deck = await convert(POLL);
    const pid = deck._id;
    const soon = new Date(Date.now() + 1_500);
    const opened = await hostCommand(pid, 'open-audience', { closesAt: soon.toISOString() });
    expect(opened.status).toBe(200);
    const ada = await join(pid, 'Ada');
    const phone = await follow(pid, { participant: ada });
    expect((await answer(pid, ada, deck.slides[0]!, 0, { optionIndex: 0 })).status).toBe(200);

    // The idle-session job does not end a session waiting for its closing time.
    const session = await PresentationSessionModel.findById(ada.sessionId).lean();
    const longAfter = new Date(Date.now() + 365 * 24 * 3600_000);
    expect(idleEndReason({ ...session!, audience: { ...session!.audience!, closesAt: new Date(longAfter.getTime() + 1) } }, longAfter, { lobbyHours: 6, liveHours: 12 })).toBeNull();
    expect(idleEndReason(session!, longAfter, { lobbyHours: 6, liveHours: 12 })).toBe('live_idle');

    // Past the closing time (plus the 750 ms grace): refused before the job even runs.
    await Bun.sleep(2_400);
    expect((await answer(pid, ada, deck.slides[1]!, 1, { optionIndex: 0 })).body.code).toBe('TIME_UP');

    const job = registeredJobs().find((candidate) => candidate.name === AUDIENCE_AUTOCLOSE_JOB);
    expect(job?.everyMs).toBe(30_000);
    const tick = Math.floor(Date.now() / job!.everyMs);
    const ran = await Promise.all([
      new Scheduler({ jobs: [job!], instanceId: 'a', log: quiet }).runTick(job!, tick),
      new Scheduler({ jobs: [job!], instanceId: 'b', log: quiet }).runTick(job!, tick),
    ]);
    expect(ran.filter(Boolean)).toHaveLength(1);
    const closed = await PresentationSessionModel.findById(ada.sessionId).lean();
    expect(closed!.audience).toMatchObject({ closeReason: 'schedule' });
    expect(closed!.isLive).toBe(true);
    await waitFor(() => phone.events.some((e) => e.type === 'audience:closed'), 'audience:closed on the phone');
    expect(phone.events.find((e) => e.type === 'audience:closed')!.payload.reason).toBe('schedule');
    expect((await liveState(pid, ada)).audience.status).toBe('closed');
  }, 20_000);

  it('refuses presenter-paced decks and sessions, templates, slide commands, bad closing times and other workspaces', async () => {
    // A presenter-paced deck.
    const presenter = await call('POST', '/', {
      user: host,
      body: { title: 'Live quiz', slides: [{ type: 'wordcloud', question: 'Word?', timeLimit: 0 }] },
    });
    const presenterId = presenter.body.data._id as string;
    expect((await hostCommand(presenterId, 'open-audience')).body.code).toBe('NOT_AUDIENCE_PACED');
    expect((await hostCommand(presenterId, 'open-lobby')).status).toBe(200);
    expect((await hostCommand(presenterId, 'close-audience')).body.code).toBe('NOT_AUDIENCE_PACED');
    const viewer = await join(presenterId, 'Viewer');
    expect((await attemptCall(presenterId, viewer, 'submit')).body.code).toBe('NOT_AUDIENCE_PACED');
    expect((await liveState(presenterId, viewer)).audience).toBeNull();

    // A template is never presented.
    const deck = await convert(POLL);
    await PresentationModel.updateOne({ _id: deck._id }, { $set: { isTemplate: true } });
    expect((await hostCommand(deck._id, 'open-audience')).body.code).toBe('TEMPLATE_NOT_PRESENTABLE');
    expect((await hostCommand(deck._id, 'start')).body.code).toBe('TEMPLATE_NOT_PRESENTABLE');
    await PresentationModel.updateOne({ _id: deck._id }, { $set: { isTemplate: false } });

    // Closing times: in the past, too far ahead, malformed.
    expect((await hostCommand(deck._id, 'open-audience', { closesAt: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    expect((await hostCommand(deck._id, 'open-audience', { closesAt: new Date(Date.now() + 40 * 24 * 3600_000).toISOString() })).status).toBe(400);
    expect((await hostCommand(deck._id, 'open-audience', { closesAt: 'tomorrow' })).status).toBe(400);

    // Not open yet; then slide commands make no sense.
    expect((await hostCommand(deck._id, 'open-lobby')).status).toBe(200);
    expect((await hostCommand(deck._id, 'close-audience')).body.code).toBe('AUDIENCE_NOT_OPEN');
    const early = await join(deck._id, 'Early');
    expect((await attemptCall(deck._id, early, 'submit')).body.code).toBe('AUDIENCE_NOT_OPEN');
    expect((await hostCommand(deck._id, 'open-audience')).status).toBe(200);
    expect((await hostCommand(deck._id, 'goto', { slideIndex: 1 })).body.code).toBe('AUDIENCE_PACED');
    expect((await hostCommand(deck._id, 'start')).body.code).toBe('SESSION_ALREADY_LIVE');
    expect((await hostCommand(deck._id, 'close')).status).toBe(400);

    // Another workspace cannot open or close it.
    const stranger = await createVerifiedUser({ name: 'Stranger' });
    expect((await hostCommand(deck._id, 'close-audience', undefined, stranger)).status).toBe(403);
    expect((await hostCommand(deck._id, 'open-audience', {}, stranger)).status).toBe(403);
    // Without a token at all.
    expect((await call('POST', `/${deck._id}/host/open-audience`)).status).toBe(401);
    // A wrong participant token.
    expect((await call('POST', `/${deck._id}/audience/submit`, { body: { participantId: early.participantId, participantToken: 'x'.repeat(48) } })).status).toBe(401);
  }, 20_000);
});
