import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { z } from 'zod';
import { PresentationService } from '../../src/modules/presentations/presentations.service';
import { commonSlideShape, defineSlideType, registerSlideType } from '../../src/modules/presentations/slides';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, sessionKey, type FakeRedis } from './harness';

/**
 * The session engine (W1-A1) on the in-memory Redis and model stubs: runs,
 * navigation both ways, close/reopen/reveal, untimed slides, the audience cap,
 * end-of-session reconciliation, participant resync and the host policy.
 */

const T0 = new Date('2026-06-01T10:00:00.000Z').getTime();
const at = (ms: number) => setSystemTime(new Date(T0 + ms));
const DAY_MS = 24 * 3600 * 1000;

const SELECT = {
  type: 'select_answer',
  question: 'Capital of France?',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 20,
};
const CLOUD = { type: 'wordcloud', question: 'One word', timeLimit: 0 };
const BOARD = { type: 'leaderboard', question: 'Standings' };

/** Test-only content type (content types ship with W1-D). */
const testTitleSlide = defineSlideType<never, never>({
  type: 'test_title',
  name: 'Test title',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: z.object({ type: z.literal('test_title'), ...commonSlideShape, content: z.object({ title: z.string() }) }),
  sanitize: (slide) => ({ title: (slide.content as { title: string }).title }),
  label: (slide) => (slide.content as { title: string }).title,
});

let redis: FakeRedis;
let models: ReturnType<typeof installModelStubs>;
let restoreRedis: () => void;
let disposeType: () => void;

beforeEach(() => {
  const fake = installFakeRedis();
  redis = fake.redis;
  restoreRedis = fake.restore;
  models = installModelStubs();
  disposeType = registerSlideType(testTitleSlide);
  at(0);
});

afterEach(async () => {
  await flush();
  disposeType();
  models.restore();
  restoreRedis();
  setSystemTime();
});

type Joined = Awaited<ReturnType<typeof PresentationService.joinPresentation>>;

const expectApiError = async (promise: Promise<unknown>, statusCode: number, codeOrMessage: string) => {
  let caught: any;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(caught.statusCode).toBe(statusCode);
  expect([caught.code, caught.message]).toContain(codeOrMessage);
};

const addDeck = (slides: Record<string, unknown>[]) =>
  models.addPresentation({ title: 'Sessions', creatorId: OWNER_ID, joinCode: '777777', slides: structuredClone(slides) });

const answer = (pid: string, who: Joined, slideIndex: number, body: Record<string, unknown>) =>
  PresentationService.submitAnswer(pid, {
    participantId: who.participantId,
    participantToken: who.token,
    slideIndex,
    ...body,
  } as any);

const join = (pid: string, name: string, deviceToken?: string) =>
  PresentationService.joinPresentation(pid, { name, ...(deviceToken ? { deviceToken } : {}) });

const slideId = (deck: any, index: number) => String(deck.slides[index]._id);

describe('sessions: every run is kept', () => {
  it('runs a deck twice into two sessions with independent participants, answers and leaderboards', async () => {
    const deck = addDeck([SELECT, BOARD]);
    const pid = String(deck._id);

    const first = await PresentationService.openLobby(pid, OWNER_ID);
    expect(first.session).toMatchObject({ runNumber: 1, status: 'lobby', isLive: true, currentSlideIndex: -1 });
    expect(redis.lastEvent('session:lobby')!.payload).toEqual({ runNumber: 1, joinCode: '777777', pace: 'presenter' });
    const ada = await join(pid, 'Ada');
    expect(ada.sessionId).toBe(first.session.sessionId);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(2_000);
    await answer(pid, ada, 0, { optionIndex: 0 });
    await flush();

    at(60_000);
    const second = await PresentationService.openLobby(pid, OWNER_ID);
    expect(second.session).toMatchObject({ runNumber: 2, status: 'lobby' });
    expect(second.session.sessionId).not.toBe(first.session.sessionId);
    // The replaced run ended with its snapshot, and nothing was deleted.
    const run1 = models.sessions.find((s) => String(s._id) === first.session.sessionId)!;
    expect(run1).toMatchObject({ status: 'ended', isLive: false, participantCount: 1, answerCount: 1 });
    expect(run1.finalLeaderboard.map((e: any) => [e.name, e.score])).toEqual([['Ada', 950]]);
    expect(redis.events('session:ended').map((e) => e.payload.runNumber)).toEqual([1]);

    const grace = await join(pid, 'Grace');
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(61_000);
    await answer(pid, grace, 0, { optionIndex: 1 });
    await PresentationService.endPresentation(pid, OWNER_ID);

    const run2 = models.sessions.find((s) => String(s._id) === second.session.sessionId)!;
    expect(run2.finalLeaderboard.map((e: any) => [e.name, e.score])).toEqual([['Grace', 0]]);
    expect(run1.finalLeaderboard.map((e: any) => [e.name, e.score])).toEqual([['Ada', 950]]);
    expect(models.participants.map((p) => [p.name, String(p.sessionId)])).toEqual([
      ['Ada', first.session.sessionId],
      ['Grace', second.session.sessionId],
    ]);
    expect(deck).toMatchObject({ status: 'ended', sessionCount: 2, activeSessionId: null });

    const sessions = await PresentationService.listSessions(pid, OWNER_ID);
    expect(sessions.map((s) => [s.runNumber, s.status, s.participantCount, s.answerCount])).toEqual([
      [2, 'ended', 1, 1],
      [1, 'ended', 1, 1],
    ]);

    // Events carry their session.
    const ended = redis.published.filter((e) => e.type === 'session:ended');
    expect(ended).toHaveLength(2);
  });

  it('rejects answers from a participant of an ended run', async () => {
    const deck = addDeck([SELECT]);
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');
    await PresentationService.openLobby(pid, OWNER_ID);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await expectApiError(answer(pid, ada, 0, { optionIndex: 0 }), 409, 'PARTICIPANT_STALE');
  });
});

describe('sessions: navigation', () => {
  it('goes back and forth; revisits show the stored phase and results and never reopen', async () => {
    const deck = addDeck([SELECT, CLOUD, BOARD]);
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');

    await PresentationService.gotoSlide(pid, OWNER_ID, { slideIndex: 0 });
    at(1_000);
    await answer(pid, ada, 0, { optionIndex: 0 });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);

    await PresentationService.gotoSlide(pid, OWNER_ID, { slideId: slideId(deck, 1) });
    await answer(pid, ada, 1, { entries: ['sun'] });
    // Leaving the open slide closes it.
    const back = await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    expect(back.session.current).toMatchObject({ slideIndex: 0, phase: 'revealed', answeredCount: 1 });
    const revisit = redis.lastEvent('question:revealed')!.payload;
    expect(revisit).toMatchObject({ slideIndex: 0, revisit: true, answeredCount: 1 });
    expect(revisit.distribution.counts).toEqual([1, 0]);
    await expectApiError(answer(pid, linus, 0, { optionIndex: 0 }), 400, 'This slide is no longer accepting answers');

    const forward = await PresentationService.gotoSlide(pid, OWNER_ID, { slideIndex: 1 });
    expect(forward.session.current).toMatchObject({ slideIndex: 1, phase: 'closed', answeredCount: 1 });
    expect(redis.lastEvent('slide:closed')!.payload).toMatchObject({ slideIndex: 1, revisit: true, answeredCount: 1 });
    await expectApiError(answer(pid, linus, 1, { entries: ['moon'] }), 400, 'This slide is no longer accepting answers');

    // The same slide again is a no-op.
    const count = redis.published.length;
    await PresentationService.gotoSlide(pid, OWNER_ID, { slideIndex: 1 });
    expect(redis.published.length).toBe(count);

    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(redis.lastEvent('leaderboard:shown')!.payload.slideIndex).toBe(2);
    await expectApiError(PresentationService.gotoSlide(pid, OWNER_ID, { slideIndex: 3 }), 400, 'Slide index out of bounds');

    const host = await PresentationService.getHostState(pid, OWNER_ID);
    expect(host.slideStates.map((s) => [s.slideIndex, s.phase, s.answeredCount])).toEqual([
      [0, 'revealed', 1],
      [1, 'closed', 1],
      [2, 'shown', 0],
    ]);
    expect(Object.values(host.distributions).map((d) => [d.slideIndex, d.answeredCount])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(host.distributions[slideId(deck, 1)]!.distribution).toEqual({ kind: 'words', words: [{ text: 'sun', count: 1 }] });
  });

  it('starts a content-only deck without a lobby, and refuses to start over a running session', async () => {
    const deck = addDeck([
      { type: 'test_title', content: { title: 'Hello' }, timeLimit: 0 },
      { type: 'test_title', content: { title: 'Bye' }, timeLimit: 0 },
    ]);
    const pid = String(deck._id);
    const started = await PresentationService.startSession(pid, OWNER_ID);
    expect(started.session).toMatchObject({ runNumber: 1, status: 'active', currentSlideIndex: 0 });
    expect(started.session.current).toMatchObject({ phase: 'shown', lifecycle: 'content' });
    expect(redis.events('session:lobby')).toEqual([]);
    expect(redis.lastEvent('slide:shown')!.payload).toMatchObject({ slideIndex: 0, slide: { title: 'Hello' } });
    expect(deck.status).toBe('active');

    await expectApiError(PresentationService.startSession(pid, OWNER_ID), 409, 'SESSION_ALREADY_LIVE');
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    expect(redis.events('slide:shown').map((e) => e.payload.slideIndex)).toEqual([0, 1, 0]);
  });

  it('starts a session waiting in its lobby at slide 0, keeping its participants', async () => {
    const deck = addDeck([SELECT]);
    const pid = String(deck._id);
    const lobby = await PresentationService.openLobby(pid, OWNER_ID);
    await join(pid, 'Ada');
    const started = await PresentationService.startSession(pid, OWNER_ID);
    expect(started.session.sessionId).toBe(lobby.session.sessionId);
    expect(started.session).toMatchObject({ status: 'active', participantCount: 1 });
    expect(redis.lastEvent('question:started')!.payload).toMatchObject({ slideIndex: 0, reopened: false });
  });

  it('needs a live session for goto and answers 400 NO_LIVE_SESSION otherwise', async () => {
    const pid = String(addDeck([SELECT])._id);
    await expectApiError(PresentationService.gotoSlide(pid, OWNER_ID, { slideIndex: 0 }), 400, 'NO_LIVE_SESSION');
  });
});

describe('sessions: answer windows', () => {
  it('keeps an untimed slide open until the host closes it, and reopens it with earlier answers kept', async () => {
    const deck = addDeck([CLOUD]);
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');
    const grace = await join(pid, 'Grace');
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:started')!.payload).toMatchObject({ endsAt: null, reopened: false });
    expect(deck.questionEndsAt).toBeNull();

    at(10 * 60_000);
    expect(await answer(pid, ada, 0, { entries: ['late but fine'] })).toEqual({ accepted: true });
    const lookup = (await PresentationService.getPresentationByCode('777777')) as Record<string, unknown>;
    expect(lookup).toMatchObject({ currentSlidePhase: 'open', questionEndsAt: null });

    const closed = await PresentationService.closeCurrentSlide(pid, OWNER_ID);
    expect(closed.session.current).toMatchObject({ phase: 'closed', answeredCount: 1 });
    expect(redis.lastEvent('slide:closed')!.payload).toMatchObject({ revisit: false, answeredCount: 1 });
    expect(redis.lastEvent('slide:closed')!.payload.distribution).toBeUndefined();
    expect(deck.questionEndsAt).toEqual(new Date(T0 + 10 * 60_000));
    await expectApiError(answer(pid, linus, 0, { entries: ['nope'] }), 400, 'This slide is no longer accepting answers');

    // Closing again is a no-op.
    const events = redis.published.length;
    await PresentationService.closeCurrentSlide(pid, OWNER_ID);
    expect(redis.published.length).toBe(events);

    at(11 * 60_000);
    const reopened = await PresentationService.reopenCurrentSlide(pid, OWNER_ID);
    expect(reopened.session.current).toMatchObject({ phase: 'open', closedAt: null });
    expect(redis.lastEvent('question:started')!.payload).toMatchObject({ reopened: true, endsAt: null });
    await answer(pid, linus, 0, { entries: ['now'] });
    await expectApiError(answer(pid, ada, 0, { entries: ['again'] }), 409, 'You already responded to this slide');

    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    await expectApiError(answer(pid, grace, 0, { entries: ['after reveal'] }), 400, 'This slide is no longer accepting answers');
    expect(redis.lastEvent('question:revealed')!.payload.answeredCount).toBe(2);
  });

  it('refuses close and reopen on slides without answers', async () => {
    const pid = String(addDeck([BOARD])._id);
    await PresentationService.startSession(pid, OWNER_ID);
    await expectApiError(PresentationService.closeCurrentSlide(pid, OWNER_ID), 400, 'Leaderboard slides have nothing to close');
    await expectApiError(PresentationService.reopenCurrentSlide(pid, OWNER_ID), 400, 'Leaderboard slides have nothing to reopen');
  });

  it('treats a 0-point select slide as ungraded: unscored, never correct, no correct option revealed', async () => {
    const deck = addDeck([{ ...SELECT, points: 0 }]);
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:started')!.payload.slide.scored).toBe(false);
    await answer(pid, ada, 0, { optionIndex: 0 });
    const sid = String(models.liveSession(pid)._id);
    expect(JSON.parse(redis.hash(sessionKey(sid, 'results', slideId(deck, 0)))[ada.participantId]!)).toMatchObject({
      isCorrect: false,
      score: 0,
      scored: false,
    });
    expect(redis.hash(sessionKey(sid, 'correct'))).toEqual({});
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload).toMatchObject({
      scored: false,
      distribution: {
        counts: [1, 0],
        options: [
          { text: 'Paris', isCorrect: false },
          { text: 'Lyon', isCorrect: false },
        ],
      },
    });
    await flush();
    expect(models.answers[0]).toMatchObject({ isCorrect: false, score: 0 });
  });
});

describe('sessions: audience cap', () => {
  it('refuses joins beyond the cap snapshotted at open with 403 SESSION_FULL; rejoins still work', async () => {
    const pid = String(addDeck([SELECT])._id);
    const opened = await PresentationService.openLobby(pid, OWNER_ID);
    // Decks without a workspace get the free plan.
    expect(opened.session.audienceCap).toBe(100);
    models.liveSession(pid).entitlementsSnapshot.audienceCap = 2;

    const ada = await join(pid, 'Ada');
    await join(pid, 'Linus');
    await expectApiError(join(pid, 'Grace'), 403, 'SESSION_FULL');
    const again = await join(pid, 'Ada', ada.deviceToken);
    expect(again.participantId).toBe(ada.participantId);
    expect(models.participants).toHaveLength(2);
    expect(redis.members(sessionKey(String(models.liveSession(pid)._id), 'seats'))).toHaveLength(2);
  });
});

describe('sessions: end and reconciliation', () => {
  it('restores answers the write-behind lost, recomputes totals and stores the snapshot with retention', async () => {
    const deck = addDeck([SELECT, CLOUD]);
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');
    await PresentationService.advanceSlide(pid, OWNER_ID);

    at(4_000);
    models.failures.answerCreate = true; // Mongo is down for these two answers.
    const logged: unknown[][] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1' });
      await answer(pid, linus, 0, { optionIndex: 1 });
      await flush();
    } finally {
      console.error = consoleError;
      models.failures.answerCreate = false;
    }
    expect(logged.map(([message]) => message)).toEqual([
      '[Presentation] Failed to persist answer:',
      '[Presentation] Failed to persist answer:',
    ]);
    expect(models.answers).toEqual([]);
    expect(models.participants.map((p) => p.score)).toEqual([0, 0]);

    await PresentationService.advanceSlide(pid, OWNER_ID);
    await answer(pid, ada, 1, { entries: ['Tea', 'Coffee'] });
    await flush();
    // The wordcloud counters vanish from Redis: the snapshot replays them from Mongo.
    const sid = String(models.liveSession(pid)._id);
    redis.store.delete(sessionKey(sid, 'dist', slideId(deck, 1)));
    redis.store.delete(sessionKey(sid, 'disp', slideId(deck, 1)));
    redis.store.delete(sessionKey(sid, 'answered', slideId(deck, 1)));

    at(30_000);
    const ended = await PresentationService.endPresentation(pid, OWNER_ID);
    expect(ended.session).toMatchObject({ status: 'ended', isLive: false, participantCount: 2, answerCount: 3 });

    const restored = models.answers.find((a) => String(a.participantId) === ada.participantId && a.slideIndex === 0)!;
    expect(restored).toMatchObject({
      sessionId: models.sessions[0]._id,
      slideId: slideId(deck, 0),
      optionIndex: 0,
      isCorrect: true,
      score: 900,
      timeMs: 4_000,
      clientAnswerId: 'ada-1',
      via: 'rest',
    });
    expect(models.answers).toHaveLength(3);
    expect(models.participants.map((p) => [p.name, p.score, p.correctCount])).toEqual([
      ['Ada', 900, 1],
      ['Linus', 0, 0],
    ]);

    const session = models.sessions[0];
    expect(session.endedAt).toEqual(new Date(T0 + 30_000));
    expect(session.retainUntil).toEqual(new Date(T0 + 30_000 + 365 * DAY_MS));
    expect(session.slideStats.map((s: any) => [s.slideIndex, s.answeredCount, s.distribution])).toEqual([
      [
        0,
        2,
        {
          kind: 'options',
          counts: [1, 1],
          options: [
            { text: 'Paris', isCorrect: true },
            { text: 'Lyon', isCorrect: false },
          ],
        },
      ],
      [1, 1, { kind: 'words', words: [{ text: 'Tea', count: 1 }, { text: 'Coffee', count: 1 }] }],
    ]);
    expect(session.finalLeaderboard.map((e: any) => [e.rank, e.name, e.score])).toEqual([
      [1, 'Ada', 900],
      [2, 'Linus', 0],
    ]);
    expect(redis.lastEvent('session:ended')!.payload).toMatchObject({ answerCount: 3, participantCount: 2 });

    // Host state after the end reads the snapshot; ending again changes nothing.
    const host = await PresentationService.getHostState(pid, OWNER_ID);
    expect(host.session).toMatchObject({ status: 'ended', answerCount: 3 });
    expect(host.distributions[slideId(deck, 1)]!.answeredCount).toBe(1);
    const events = redis.published.length;
    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(redis.published.length).toBe(events);
  });
});

describe('sessions: participant resync (live-state)', () => {
  it('reports the current slide by phase without leaking answer keys, then the final standings', async () => {
    const deck = addDeck([SELECT, BOARD]);
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');

    const lobby = await PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token);
    expect(lobby).toMatchObject({ status: 'lobby', current: null, finalLeaderboard: null, joinCode: '777777' });
    expect(lobby.settings.nickname).toBe('required');
    expect(lobby.theme?.presetId).toBe('amber');

    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(1_000);
    const open = await PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token);
    expect(open.current).toMatchObject({ slideIndex: 0, phase: 'open', results: null, endsAt: new Date(T0 + 20_000).toISOString() });
    expect(JSON.stringify(open)).not.toContain('isCorrect');
    expect(open.me.answeredCurrent).toBe(false);

    await answer(pid, ada, 0, { optionIndex: 0 });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    const revealed = await PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token);
    expect(revealed.current).toMatchObject({ phase: 'revealed', results: { answeredCount: 1 } });
    expect(revealed.me).toMatchObject({ answeredCurrent: true, totalScore: 975, rank: 1, lastAnswer: { isCorrect: true } });

    await PresentationService.advanceSlide(pid, OWNER_ID);
    const board = await PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token);
    expect(board.current!.leaderboard!.map((e) => e.name)).toEqual(['Ada']);

    await PresentationService.endPresentation(pid, OWNER_ID);
    const ended = await PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token);
    expect(ended.status).toBe('ended');
    expect(ended.finalLeaderboard!.map((e) => [e.name, e.score])).toEqual([['Ada', 975]]);
  });

  it('refuses removed participants with 403 PARTICIPANT_KICKED', async () => {
    const pid = String(addDeck([SELECT])._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await join(pid, 'Ada');
    await redis.sAdd(sessionKey(String(models.liveSession(pid)._id), 'kicked'), ada.participantId);
    await expectApiError(
      PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token),
      403,
      'PARTICIPANT_KICKED',
    );
    expect(await PresentationService.isAuthorizedParticipant(pid, ada.participantId, ada.token)).toBe(false);
  });
});

describe('sessions: host policy', () => {
  it('refuses every host command and read to someone who may not host the deck', async () => {
    const pid = String(addDeck([SELECT])._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const stranger = 'someone-else';
    for (const call of [
      () => PresentationService.openLobby(pid, stranger),
      () => PresentationService.startSession(pid, stranger),
      () => PresentationService.gotoSlide(pid, stranger, { slideIndex: 0 }),
      () => PresentationService.closeCurrentSlide(pid, stranger),
      () => PresentationService.reopenCurrentSlide(pid, stranger),
      () => PresentationService.revealCurrentSlide(pid, stranger),
      () => PresentationService.endPresentation(pid, stranger),
      () => PresentationService.getHostState(pid, stranger),
      () => PresentationService.listSessions(pid, stranger),
    ]) {
      await expectApiError(call(), 403, 'FORBIDDEN');
    }
  });
});
