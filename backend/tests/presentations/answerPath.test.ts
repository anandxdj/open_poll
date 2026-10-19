import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { PresentationService } from '../../src/modules/presentations/presentations.service';
import { answersAccepted, answersRejected } from '../../src/common/observability/metrics';
import { flushScheduledNow, flushDirty, resetCoalescerCache } from '../../src/modules/presentations/live/coalescer';
import { runAutoRevealTick } from '../../src/modules/presentations/live/autoRevealWorker';
import { k } from '../../src/modules/presentations/live/keys';
import { ANSWER_RATE_MAX } from '../../src/modules/presentations/live/answerScript';
import {
  applyParticipantIncrements,
  insertAnswerBatch,
  type PendingAnswer,
} from '../../src/modules/presentations/live/writeBehind';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, type FakeRedis } from './harness';

/**
 * The answer path on the in-memory Redis (whose script is a port of
 * `answer.lua`, kept honest by tests/integration/answerScript.test.ts):
 * idempotent replays, grace windows and slide tickets, channels, rate limits,
 * the coalescer, auto-reveal and the end-of-session score race.
 */

const T0 = new Date('2026-07-01T10:00:00.000Z').getTime();
const at = (ms: number) => setSystemTime(new Date(T0 + ms));

const SELECT = {
  type: 'select_answer',
  question: 'Capital of France?',
  options: [
    { text: 'Paris', isCorrect: true },
    { text: 'Lyon', isCorrect: false },
  ],
  timeLimit: 20,
};
/** Unscored but timed. */
const OPEN = { type: 'open_ended', question: 'Thoughts?', timeLimit: 20 };
/** Unscored and untimed. */
const CLOUD = { type: 'wordcloud', question: 'One word', timeLimit: 0 };

let redis: FakeRedis;
let models: ReturnType<typeof installModelStubs>;
let restoreRedis: () => void;

beforeEach(() => {
  const fake = installFakeRedis();
  redis = fake.redis;
  restoreRedis = fake.restore;
  models = installModelStubs();
  resetCoalescerCache();
  at(0);
});

afterEach(async () => {
  await flush();
  models.restore();
  restoreRedis();
  setSystemTime();
});

type Joined = Awaited<ReturnType<typeof PresentationService.joinPresentation>>;

const deckOf = async (slides: Record<string, unknown>[], people = ['Ada', 'Linus', 'Grace']) => {
  const deck = models.addPresentation({ title: 'Answers', creatorId: OWNER_ID, joinCode: '616161', slides: structuredClone(slides) });
  const pid = String(deck._id);
  await PresentationService.openLobby(pid, OWNER_ID);
  const joined: Joined[] = [];
  for (const name of people) joined.push(await PresentationService.joinPresentation(pid, { name }));
  const sid = String(models.liveSession(pid)._id);
  return { deck, pid, sid, joined, slideId: (index: number) => String(deck.slides[index]._id) };
};

const answer = (pid: string, who: Joined, slideIndex: number, body: Record<string, unknown>) =>
  PresentationService.submitAnswer(pid, {
    participantId: who.participantId,
    participantToken: who.token,
    slideIndex,
    ...body,
  } as never);

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as { statusCode: number; message: string; code?: string };
    return { status: e.statusCode, message: e.message, code: e.code };
  }
  throw new Error('Expected the call to be rejected');
};

const currentTicket = () => redis.lastEvent('question:started')!.payload.slideTicket as string;

const counterValue = async (counter: { get(): Promise<{ values: { value: number; labels: Record<string, unknown> }[] }> }, labels: Record<string, string>) => {
  const { values } = await counter.get();
  return values.find((v) => Object.entries(labels).every(([key, value]) => v.labels[key] === value))?.value ?? 0;
};

describe('idempotent replays', () => {
  it('returns the original result for a repeat with the same clientAnswerId and counts nothing twice', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);

    at(3_000);
    const first = await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1' });
    expect(first).toEqual({
      accepted: true,
      replay: false,
      slideId: slideId(0),
      slideIndex: 0,
      clientAnswerId: 'ada-1',
      via: 'rest',
      answeredAt: new Date(T0 + 3_000).toISOString(),
    });

    at(9_000);
    const again = await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1', offline: true });
    // The original result, not a new one: same answeredAt and channel, flagged as a replay.
    expect(again).toEqual({ ...first, replay: true });

    expect(redis.zset(k.scores(sid))[ada.participantId]).toBe(925);
    expect(redis.hash(k.correct(sid))[ada.participantId]).toBe('1');
    expect(redis.hash(k.dist(sid, slideId(0)))).toEqual({ '0': '1' });
    expect(redis.members(k.answered(sid, slideId(0)))).toEqual([ada.participantId]);

    await flush();
    expect(models.answers).toHaveLength(1);
    expect(models.participants.find((p) => String(p._id) === ada.participantId)).toMatchObject({ score: 925, correctCount: 1 });
  });

  it('treats a different or missing clientAnswerId as a second answer', async () => {
    const { pid, joined } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1' });
    expect(await failure(answer(pid, ada, 0, { optionIndex: 1, clientAnswerId: 'ada-2' }))).toMatchObject({
      status: 409,
      code: 'ALREADY_ANSWERED',
    });
    expect(await failure(answer(pid, ada, 0, { optionIndex: 1 }))).toMatchObject({ status: 409, code: 'ALREADY_ANSWERED' });
  });

  it('still answers a replay after the slide closed (a lost ack retried from the offline queue)', async () => {
    const { pid, joined } = await deckOf([SELECT]);
    const [ada, linus] = joined as [Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const first = await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1' });

    at(2_000);
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'ada-1' })).toEqual({ ...first, replay: true });
    // Someone who never answered is still refused.
    expect(await failure(answer(pid, linus, 0, { optionIndex: 0, clientAnswerId: 'linus-1' }))).toMatchObject({
      status: 400,
      code: 'NOT_ACCEPTING',
    });
  });
});

describe('channels', () => {
  it('stores via: rest by default, socket for the socket channel, offline for queued answers', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT, OPEN]);
    const [ada, linus, grace] = joined as [Joined, Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);

    const viaOf = (who: Joined) =>
      JSON.parse(redis.hash(k.results(sid, slideId(0)))[who.participantId]!).via as string;
    await answer(pid, ada, 0, { optionIndex: 0 });
    await PresentationService.submitAnswer(
      pid,
      { participantId: linus.participantId, participantToken: linus.token, slideIndex: 0, optionIndex: 1 } as never,
      { via: 'socket' }
    );
    await PresentationService.submitAnswer(
      pid,
      { participantId: grace.participantId, participantToken: grace.token, slideIndex: 0, optionIndex: 1, offline: true } as never,
      { via: 'socket' }
    );
    expect([ada, linus, grace].map(viaOf)).toEqual(['rest', 'socket', 'offline']);

    await flush();
    expect(models.answers.map((a) => a.via).sort()).toEqual(['offline', 'rest', 'socket']);
  });

  it('counts accepted, replayed and rejected answers in the metrics', async () => {
    const { pid, joined } = await deckOf([SELECT]);
    const [ada, linus] = joined as [Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const before = {
      fresh: await counterValue(answersAccepted, { via: 'rest', replay: 'false' }),
      replay: await counterValue(answersAccepted, { via: 'rest', replay: 'true' }),
      dup: await counterValue(answersRejected, { via: 'rest', reason: 'already_answered' }),
      badToken: await counterValue(answersRejected, { via: 'rest', reason: 'http_401' }),
    };
    await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'c1' });
    await answer(pid, ada, 0, { optionIndex: 0, clientAnswerId: 'c1' });
    await failure(answer(pid, ada, 0, { optionIndex: 1 }));
    await failure(answer(pid, { ...linus, token: 'x'.repeat(48) }, 0, { optionIndex: 1 }));

    expect(await counterValue(answersAccepted, { via: 'rest', replay: 'false' })).toBe(before.fresh + 1);
    expect(await counterValue(answersAccepted, { via: 'rest', replay: 'true' })).toBe(before.replay + 1);
    expect(await counterValue(answersRejected, { via: 'rest', reason: 'already_answered' })).toBe(before.dup + 1);
    expect(await counterValue(answersRejected, { via: 'rest', reason: 'http_401' })).toBe(before.badToken + 1);
  });
});

describe('grace windows and slide tickets', () => {
  it('takes an unscored answer up to 15 s after the timer when it carries the ticket issued while open', async () => {
    const { pid, joined } = await deckOf([OPEN]);
    const [ada, linus, grace] = joined as [Joined, Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const ticket = currentTicket();
    expect(ticket).toMatch(/^st1\.[a-f0-9]{32}$/);

    at(20_000 + 750);
    expect(await answer(pid, ada, 0, { text: 'on the edge' })).toMatchObject({ accepted: true });

    at(20_000 + 751);
    expect(await failure(answer(pid, linus, 0, { text: 'late, no ticket' }))).toMatchObject({ status: 400, code: 'TIME_UP' });
    expect(await answer(pid, linus, 0, { text: 'late, ticket', slideTicket: ticket })).toMatchObject({ accepted: true });

    at(20_000 + 15_000);
    expect(await answer(pid, grace, 0, { text: 'last moment', slideTicket: ticket })).toMatchObject({ accepted: true });
  });

  it('stops at endsAt + 15 s even with a ticket', async () => {
    const { pid, joined } = await deckOf([OPEN]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(20_000 + 15_001);
    expect(await failure(answer(pid, ada, 0, { text: 'too late', slideTicket: currentTicket() }))).toMatchObject({
      status: 400,
      code: 'TIME_UP',
    });
  });

  it('ignores a ticket that is forged, from another slide, or from before a reopen', async () => {
    const { pid, joined } = await deckOf([OPEN, OPEN]);
    const [ada, linus, grace] = joined as [Joined, Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const firstTicket = currentTicket();
    await PresentationService.advanceSlide(pid, OWNER_ID); // slide 1 (slide 0 stays visited and closed)
    const secondTicket = currentTicket();
    expect(secondTicket).not.toBe(firstTicket);

    at(20_000 + 5_000);
    const late = (who: Joined, slideTicket: string) => failure(answer(pid, who, 1, { text: 'x', slideTicket }));
    expect(await late(ada, firstTicket)).toMatchObject({ code: 'TIME_UP' }); // issued for slide 0
    expect(await late(linus, `st1.${'0'.repeat(32)}`)).toMatchObject({ code: 'TIME_UP' }); // forged
    expect(await late(grace, `${secondTicket.slice(0, -1)}${secondTicket.endsWith('0') ? '1' : '0'}`)).toMatchObject({
      code: 'TIME_UP',
    }); // one character off
    expect(await answer(pid, grace, 1, { text: 'ok', slideTicket: secondTicket })).toMatchObject({ accepted: true });

    // Reopening starts a new run of the slide: the earlier ticket no longer proves anything.
    await PresentationService.closeCurrentSlide(pid, OWNER_ID);
    at(21_000);
    await PresentationService.reopenCurrentSlide(pid, OWNER_ID);
    const reopenedTicket = currentTicket();
    expect(reopenedTicket).not.toBe(secondTicket);
    at(21_000 + 20_000 + 5_000);
    expect(await late(ada, secondTicket)).toMatchObject({ code: 'TIME_UP' });
    expect(await answer(pid, ada, 1, { text: 'new run', slideTicket: reopenedTicket })).toMatchObject({ accepted: true });
  });

  it('keeps taking a scored answer after the timer until the reveal, then refuses it', async () => {
    const { pid, joined } = await deckOf([SELECT]);
    const [ada, linus, grace] = joined as [Joined, Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const ticket = currentTicket();

    at(20_000 + 3_000);
    expect(await failure(answer(pid, ada, 0, { optionIndex: 0 }))).toMatchObject({ code: 'TIME_UP' });
    expect(await answer(pid, ada, 0, { optionIndex: 0, slideTicket: ticket })).toMatchObject({ accepted: true });

    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(await failure(answer(pid, linus, 0, { optionIndex: 0, slideTicket: ticket }))).toMatchObject({
      status: 400,
      code: 'NOT_ACCEPTING',
    });
    expect(await failure(answer(pid, grace, 0, { optionIndex: 0 }))).toMatchObject({ code: 'NOT_ACCEPTING' });
  });

  it('never reopens a slide through a ticket: close and ended sessions refuse it', async () => {
    const { pid, joined } = await deckOf([CLOUD]);
    const [ada, linus] = joined as [Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const ticket = currentTicket();
    await PresentationService.closeCurrentSlide(pid, OWNER_ID);
    expect(await failure(answer(pid, ada, 0, { entries: ['x'], slideTicket: ticket }))).toMatchObject({ code: 'NOT_ACCEPTING' });

    await PresentationService.reopenCurrentSlide(pid, OWNER_ID);
    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(await failure(answer(pid, linus, 0, { entries: ['y'], slideTicket: ticket }))).toMatchObject({ code: 'NOT_ACCEPTING' });
  });

  it('hands the ticket to participants in live-state only while the window is open', async () => {
    const { pid, joined } = await deckOf([SELECT, { type: 'leaderboard', question: 'Board' }]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const state = () => PresentationService.getParticipantLiveState(pid, ada.participantId, ada.token);

    expect((await state()).current!.slideTicket).toBe(currentTicket());
    at(20_000 + 3_000); // timer over, host has not acted: still open, still ticketed
    expect((await state()).current!.slideTicket).toBe(currentTicket());
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect((await state()).current!.slideTicket).toBeNull();
  });
});

describe('participant checks and limits', () => {
  it('refuses a kicked participant, an unknown token and a participant of an ended session', async () => {
    const { pid, sid, joined } = await deckOf([SELECT]);
    const [ada, linus] = joined as [Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);

    await redis.sAdd(k.kicked(sid), linus.participantId);
    expect(await failure(answer(pid, linus, 0, { optionIndex: 0 }))).toMatchObject({ status: 403, code: 'PARTICIPANT_KICKED' });
    expect(await failure(answer(pid, { ...ada, token: 'z'.repeat(48) }, 0, { optionIndex: 0 }))).toMatchObject({ status: 401 });
    expect(redis.members(k.answered(sid, String(models.liveSession(pid).deckSnapshot[0]._id)))).toEqual([]);
  });

  it('finds a participant whose token is missing from Redis in Mongo, and answers', async () => {
    const { pid, sid, joined } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    redis.store.delete(k.tokens(sid)); // a Redis restart lost the mirror

    expect(await answer(pid, ada, 0, { optionIndex: 0 })).toMatchObject({ accepted: true });
    expect(redis.hash(k.tokens(sid))[ada.participantId]).toBe(ada.token);
    // A wrong token is still refused, from Mongo.
    expect(await failure(answer(pid, { ...ada, participantId: ada.participantId, token: 'q'.repeat(48) }, 0, { optionIndex: 0 }))).toMatchObject({
      status: 401,
    });
  });

  it('rejects a participant from an earlier session as stale', async () => {
    const { pid, joined } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.openLobby(pid, OWNER_ID); // run 2 ends run 1
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(await failure(answer(pid, ada, 0, { optionIndex: 0 }))).toMatchObject({ status: 409, code: 'PARTICIPANT_STALE' });
  });

  it('allows a burst of attempts per participant and then refuses with 429, writing nothing for the refused ones', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await answer(pid, ada, 0, { optionIndex: 0 });
    for (let attempt = 2; attempt <= ANSWER_RATE_MAX; attempt += 1) {
      expect(await failure(answer(pid, ada, 0, { optionIndex: 1 }))).toMatchObject({ status: 409 });
    }
    expect(await failure(answer(pid, ada, 0, { optionIndex: 1 }))).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(redis.members(k.answered(sid, slideId(0)))).toEqual([ada.participantId]);

    at(10_001); // the window rolls over
    expect(await failure(answer(pid, ada, 0, { optionIndex: 1 }))).toMatchObject({ status: 409 });
  });

  it('refuses a malformed payload before touching Redis and lets the participant retry', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(await failure(answer(pid, ada, 0, { optionIndex: 5 }))).toMatchObject({ status: 400 });
    expect(redis.members(k.answered(sid, slideId(0)))).toEqual([]);
    expect(await answer(pid, ada, 0, { optionIndex: 0 })).toMatchObject({ accepted: true });
  });
});

describe('coalesced host updates', () => {
  const answersOnSlide = async (people: Joined[], pid: string) => {
    for (const who of people) await answer(pid, who, 0, { optionIndex: 0 });
  };

  it('publishes ONE host-only answer:received per 250 ms window however many answers arrive', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await answersOnSlide(joined, pid);
    expect(redis.events('answer:received')).toEqual([]); // nothing per answer any more

    expect(await flushScheduledNow()).toBe(1);
    const events = redis.events('answer:received');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: 'host',
      payload: { slideId: slideId(0), slideIndex: 0, answeredCount: 3, participantCount: 3 },
    });
    expect(events[0]!.payload.distribution).toMatchObject({ kind: 'options', counts: [3, 0] });
    expect(redis.members(k.dirtySlides(sid))).toEqual([]);
  });

  it('opens a new window once the 250 ms are over, and only one answer owns each window', async () => {
    const { pid, joined } = await deckOf([SELECT]);
    const [ada, linus, grace] = joined as [Joined, Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);

    await answer(pid, ada, 0, { optionIndex: 0 });
    at(100);
    await answer(pid, linus, 0, { optionIndex: 0 });
    expect(await flushScheduledNow()).toBe(1); // one timer was scheduled for both
    expect(redis.lastEvent('answer:received')!.payload.answeredCount).toBe(2);

    at(251);
    await answer(pid, grace, 0, { optionIndex: 1 });
    expect(await flushScheduledNow()).toBe(1);
    expect(redis.events('answer:received').map((e) => e.payload.answeredCount)).toEqual([2, 3]);
  });

  it('gives every dirty slide to exactly one flush when flushes overlap (two instances)', async () => {
    const { pid, sid, joined } = await deckOf([SELECT]);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await answersOnSlide(joined, pid);

    const published = await Promise.all([flushDirty(pid, sid), flushDirty(pid, sid), flushDirty(pid, sid)]);
    expect(published.reduce((sum, n) => sum + n, 0)).toBe(1);
    expect(redis.events('answer:received')).toHaveLength(1);
  });

  it('sends the host the last counts before the slide changes, and nothing is left for later', async () => {
    const { pid, joined } = await deckOf([SELECT, CLOUD]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await answer(pid, ada, 0, { optionIndex: 0 });
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const types = redis.events().map((e) => e.type);
    expect(types.indexOf('answer:received')).toBeGreaterThan(-1);
    expect(types.indexOf('answer:received')).toBeLessThan(types.lastIndexOf('question:started'));
    expect(await flushScheduledNow()).toBe(0);
  });
});

describe('auto-reveal of scored timed slides', () => {
  const dueEntries = (sid: string) => redis.zset('live:autoreveal');

  it('schedules a scored timed slide 1.5 s after its timer, and reveals it then', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT, OPEN]);
    const [ada, linus] = joined as [Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(dueEntries(sid)).toEqual({ [`${sid}|${slideId(0)}`]: T0 + 20_000 + 1_500 });

    await answer(pid, ada, 0, { optionIndex: 0 });
    expect(await runAutoRevealTick(T0 + 21_000)).toBe(0); // not due yet
    at(21_501);
    expect(await runAutoRevealTick(T0 + 21_501)).toBe(1);

    const revealed = redis.lastEvent('question:revealed')!;
    expect(revealed.payload).toMatchObject({ slideId: slideId(0), answeredCount: 1, revisit: false });
    expect(models.liveSession(pid).slideStates.get(slideId(0))).toMatchObject({ revealedAt: new Date(T0 + 21_501) });
    expect(dueEntries(sid)).toEqual({});
    // Revealed means closed: not even a ticket opens it again.
    expect(await failure(answer(pid, linus, 0, { optionIndex: 0 }))).toMatchObject({ code: 'NOT_ACCEPTING' });
    // And it happens once.
    expect(await runAutoRevealTick(T0 + 30_000)).toBe(0);
    expect(redis.events('question:revealed')).toHaveLength(1);
  });

  it('leaves unscored and untimed slides to the host', async () => {
    const { pid, sid } = await deckOf([OPEN, CLOUD]);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(dueEntries(sid)).toEqual({});
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(dueEntries(sid)).toEqual({});
    expect(await runAutoRevealTick(T0 + 120_000)).toBe(0);
  });

  it('yields to the host: a manual reveal, a close, leaving the slide or a reopen change the schedule', async () => {
    const { pid, sid, slideId } = await deckOf([SELECT, SELECT]);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const entry = `${sid}|${slideId(0)}`;
    expect(Object.keys(dueEntries(sid))).toEqual([entry]);

    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(dueEntries(sid)).toEqual({});
    expect(await runAutoRevealTick(T0 + 60_000)).toBe(0);
    expect(redis.events('question:revealed')).toHaveLength(1);

    await PresentationService.reopenCurrentSlide(pid, OWNER_ID);
    expect(Object.keys(dueEntries(sid))).toEqual([entry]);
    await PresentationService.advanceSlide(pid, OWNER_ID); // leaves slide 0 (closes it), opens slide 1
    expect(Object.keys(dueEntries(sid))).toEqual([`${sid}|${slideId(1)}`]);

    await PresentationService.closeCurrentSlide(pid, OWNER_ID);
    expect(dueEntries(sid)).toEqual({});
  });

  it('does nothing for a slide the host already left, even if its entry survived', async () => {
    const { pid, sid, slideId } = await deckOf([SELECT, CLOUD]);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    await redis.zAdd('live:autoreveal', { score: T0, value: `${sid}|${slideId(0)}` });
    expect(await runAutoRevealTick(T0 + 60_000)).toBe(0);
    expect(redis.events('question:revealed')).toEqual([]);
  });
});

describe('end of session: the score race', () => {
  const pendingFrom = (pid: string, sid: string, slideId: string, who: Joined): PendingAnswer => {
    const stored = JSON.parse(redis.hash(k.results(sid, slideId))[who.participantId]!);
    return {
      presentationId: pid,
      sessionId: sid,
      participantId: who.participantId,
      slideId,
      slideIndex: stored.slideIndex,
      optionIndex: stored.optionIndex,
      text: stored.text,
      payload: stored.payload,
      isCorrect: stored.isCorrect,
      score: stored.score,
      timeMs: stored.timeMs,
      clientAnswerId: stored.clientAnswerId,
      via: stored.via,
    };
  };
  const scoreOf = (who: Joined) => models.participants.find((p) => String(p._id) === who.participantId)!;

  it('does not add an answer’s points again when the batch lands after reconciliation counted it', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(1_000);
    await answer(pid, ada, 0, { optionIndex: 0 });
    // The batch got as far as inserting the answer, but its participant increment is still on the way...
    const inserted = await insertAnswerBatch([pendingFrom(pid, sid, slideId(0), ada)]);
    expect(inserted).toHaveLength(1);
    expect(models.answers).toHaveLength(1);
    expect(scoreOf(ada)).toMatchObject({ score: 0, correctCount: 0 });

    // ...when the host ends the session: reconciliation recounts the totals from the stored answers.
    at(2_000);
    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(scoreOf(ada)).toMatchObject({ score: 975, correctCount: 1 });

    // The late increment must not count the same answer a second time.
    await applyParticipantIncrements(inserted);
    expect(scoreOf(ada)).toMatchObject({ score: 975, correctCount: 1 });
    expect(scoreOf(ada).scoreFinalAt).toBeInstanceOf(Date);
  });

  it('keeps totals exact when the increment landed before the recount, and when reconciliation inserted the answer itself', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    const [ada, linus] = joined as [Joined, Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(1_000);
    await answer(pid, ada, 0, { optionIndex: 0 });
    await answer(pid, linus, 0, { optionIndex: 0 });
    // Ada's batch completed in full before the end; Linus's write-behind was lost.
    await applyParticipantIncrements(await insertAnswerBatch([pendingFrom(pid, sid, slideId(0), ada)]));
    expect(scoreOf(ada).score).toBe(975);

    at(2_000);
    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(models.answers).toHaveLength(2);
    expect(scoreOf(ada)).toMatchObject({ score: 975, correctCount: 1 });
    expect(scoreOf(linus)).toMatchObject({ score: 975, correctCount: 1 });

    // Linus's own batch finally arrives: the answer already exists, nothing is new, nothing is added.
    const late = await insertAnswerBatch([pendingFrom(pid, sid, slideId(0), linus)]);
    expect(late).toEqual([]);
    await applyParticipantIncrements(late);
    expect(scoreOf(linus)).toMatchObject({ score: 975, correctCount: 1 });
  });

  it('adds nothing for a session that is still running when it gets there first', async () => {
    const { pid, sid, joined, slideId } = await deckOf([SELECT]);
    const [ada] = joined as [Joined];
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(1_000);
    await answer(pid, ada, 0, { optionIndex: 0 });
    await flush();
    expect(scoreOf(ada)).toMatchObject({ score: 975, correctCount: 1 });
    // Running the same batch again (a retry) finds the answer stored and adds no points.
    await applyParticipantIncrements(await insertAnswerBatch([pendingFrom(pid, sid, slideId(0), ada)]));
    expect(scoreOf(ada)).toMatchObject({ score: 975, correctCount: 1 });
  });
});

describe('write-behind batches', () => {
  it('writes a burst as one batch, per-participant totals included', async () => {
    const people = ['A', 'B', 'C', 'D', 'E', 'F'];
    const { pid, joined } = await deckOf([SELECT], people);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(2_000);
    for (const who of joined) await answer(pid, who, 0, { optionIndex: 0 });
    expect(models.answers).toHaveLength(0); // nothing written on the request path
    await flush();
    expect(models.answers).toHaveLength(6);
    expect(models.participants.map((p) => p.score)).toEqual(people.map(() => 950));
  });
});

