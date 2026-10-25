import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { redisClient } from '../../src/common/config/redis';
import {
  runAnswerScript,
  scriptArguments,
  scriptKeys,
  type AnswerScriptInput,
  type AnswerScriptReply,
} from '../../src/modules/presentations/live/answerScript';
import { k } from '../../src/modules/presentations/live/keys';
import { FakeRedis } from '../presentations/harness';
import { runFakeAnswerScript } from '../presentations/answerScript.fake';
import { describeIntegration, startTestServer, type TestServer } from './harness';

/**
 * The answer script (`lua/answer.lua`) against a real Redis, and the same
 * scenarios through the JS port the unit tests run on: replies and resulting
 * state must be identical, so the fast fake can be trusted. Also the
 * concurrency guarantees only a real server can prove: atomic dedup and exact
 * counters under a burst.
 */

const oid = () => new mongoose.Types.ObjectId().toString();

interface Harness {
  /** Seed + run against one backend. */
  seed(sid: string, slideId: string, options?: SeedOptions): Promise<void>;
  run(input: AnswerScriptInput): Promise<AnswerScriptReply>;
  dump(sid: string, slideId: string): Promise<Record<string, unknown>>;
}

interface SeedOptions {
  window?: Partial<{ open: boolean; endsAtMs: number | null; slideIndex: number; startedAtMs: number }>;
  status?: string;
  participants?: Record<string, string>;
  kicked?: string[];
}

const NOW = 1_800_000_000_000;
const STARTED = NOW - 5_000;

const windowJson = (slideId: string, options: SeedOptions['window'] = {}) =>
  JSON.stringify({
    v: 3,
    slideId,
    slideIndex: 0,
    type: 'select_answer',
    scored: true,
    open: true,
    startedAtMs: STARTED,
    endsAtMs: null,
    pausedRemainingMs: null,
    cfg: null,
    ...options,
  });

const input = (sid: string, slideId: string, participantId: string, overrides: Partial<AnswerScriptInput> = {}): AnswerScriptInput => ({
  sessionId: sid,
  slideId,
  participantId,
  participantToken: `token-${participantId}`,
  slideIndex: 0,
  startedAtMs: STARTED,
  nowMs: NOW,
  ticketOk: false,
  score: 100,
  isCorrect: true,
  storedJson: JSON.stringify({ isCorrect: true, score: 100, via: 'rest', clientAnswerId: `c-${participantId}` }),
  ops: [{ op: 'hincrby', key: 'dist', field: '0', by: 1 }],
  ...overrides,
});

/** Scenarios: each seeds, runs a sequence of inputs, and returns every reply. */
interface Scenario {
  name: string;
  seed?: SeedOptions;
  steps: ((sid: string, slideId: string) => AnswerScriptInput)[];
}

const P = ['p1', 'p2', 'p3'].map((name) => `${name}-${randomUUID().slice(0, 8)}`);
const tokens = Object.fromEntries(P.map((id) => [id, `token-${id}`]));

const scenarios: Scenario[] = [
  {
    name: 'accepts, marks the first answer as the window owner, and refuses a second answer',
    steps: [
      (s, l) => input(s, l, P[0]!),
      (s, l) => input(s, l, P[1]!),
      (s, l) => input(s, l, P[0]!, { score: 5 }),
    ],
  },
  {
    name: 'runs every op kind generically (hincrby, hsetnx, lpush_trim with a cap)',
    steps: [
      (s, l) =>
        input(s, l, P[0]!, {
          ops: [
            { op: 'hincrby', key: 'dist', field: 'tea', by: 1 },
            { op: 'hsetnx', key: 'disp', field: 'tea', value: 'Tea' },
            { op: 'lpush_trim', key: 'feed', value: 'Tea', max: 2 },
          ],
        }),
      (s, l) =>
        input(s, l, P[1]!, {
          isCorrect: false,
          score: 0,
          ops: [
            { op: 'hincrby', key: 'dist', field: 'tea', by: 1 },
            { op: 'hsetnx', key: 'disp', field: 'tea', value: 'TEA' },
            { op: 'lpush_trim', key: 'feed', value: 'TEA', max: 2 },
          ],
        }),
      (s, l) => input(s, l, P[2]!, { ops: [{ op: 'lpush_trim', key: 'feed', value: 'third', max: 2 }] }),
    ],
  },
  {
    name: 'rejects an op it does not know before writing anything',
    steps: [
      (s, l) => input(s, l, P[0]!, { ops: [{ op: 'hincrby', key: 'dist', field: '0', by: 1 }, { op: 'zadd' as never, key: 'dist' } as never] }),
      (s, l) => input(s, l, P[1]!, { ops: [{ op: 'hincrby', key: 'nope' as never, field: '0', by: 1 }] }),
      (s, l) => input(s, l, P[2]!),
    ],
  },
  {
    name: 'authenticates before it counts: bad token, missing token, kicked',
    seed: { kicked: [P[2]!] },
    steps: [
      (s, l) => input(s, l, P[0]!, { participantToken: 'wrong' }),
      (s, l) => input(s, l, 'ghost-participant'),
      (s, l) => input(s, l, P[2]!),
      (s, l) => input(s, l, P[0]!),
    ],
  },
  {
    name: 'refuses an unknown slide and a window the client did not grade against',
    steps: [
      (s) => input(s, `missing-${randomUUID()}`, P[0]!),
      (s, l) => input(s, l, P[0]!, { startedAtMs: STARTED + 1 }),
      (s, l) => input(s, l, P[0]!, { slideIndex: 4 }),
      (s, l) => input(s, l, P[0]!),
    ],
  },
  {
    name: 'timed slide: grace 750 ms, ticket grace 15 s, then time is up',
    seed: { window: { endsAtMs: NOW - 1_000 } },
    steps: [
      (s, l) => input(s, l, P[0]!), // 1 s late, no ticket: refused
      (s, l) => input(s, l, P[0]!, { nowMs: NOW - 1_000 + 750 }), // exactly at the grace edge: taken
      (s, l) => input(s, l, P[1]!, { ticketOk: true }), // 1 s late with a ticket: taken
      (s, l) => input(s, l, P[2]!, { ticketOk: true, nowMs: NOW - 1_000 + 15_001 }), // past the ticket grace
    ],
  },
  {
    name: 'a closed slide refuses answers, even with a ticket',
    seed: { window: { open: false } },
    steps: [(s, l) => input(s, l, P[0]!, { ticketOk: true })],
  },
  {
    name: 'an ended session refuses even an open window',
    seed: { status: 'ended' },
    steps: [(s, l) => input(s, l, P[0]!, { ticketOk: true })],
  },
];

const tryEach = async (name: string, backend: Harness, scenario: Scenario, ids: { sid: string; slideId: string }) => {
  const { sid, slideId } = ids;
  await backend.seed(sid, slideId, scenario.seed);
  const replies: AnswerScriptReply[] = [];
  for (const step of scenario.steps) replies.push(await backend.run(step(sid, slideId)));
  return { replies, state: await backend.dump(sid, slideId), name };
};

const sortedMembers = (members: string[]) => [...members].sort();

const realBackend: Harness = {
  async seed(sid, slideId, options = {}) {
    await redisClient.hSet(k.meta(sid), 'status', options.status ?? 'active');
    await redisClient.hSet(k.slides(sid), slideId, windowJson(slideId, options.window));
    await redisClient.hSet(k.tokens(sid), options.participants ?? tokens);
    for (const id of options.kicked ?? []) await redisClient.sAdd(k.kicked(sid), id);
  },
  run: (call) => runAnswerScript(call),
  async dump(sid, slideId) {
    const [results, answered, scores, correct, dist, disp, feed, dirtySlides, dirty] = await Promise.all([
      redisClient.hGetAll(k.results(sid, slideId)),
      redisClient.sMembers(k.answered(sid, slideId)),
      redisClient.zRangeWithScores(k.scores(sid), 0, -1),
      redisClient.hGetAll(k.correct(sid)),
      redisClient.hGetAll(k.dist(sid, slideId)),
      redisClient.hGetAll(k.disp(sid, slideId)),
      redisClient.lRange(k.feed(sid, slideId), 0, -1),
      redisClient.sMembers(k.dirtySlides(sid)),
      redisClient.exists(k.dirty(sid)),
    ]);
    const ttl = await redisClient.ttl(k.answered(sid, slideId));
    return {
      results: Object.keys(results).sort(),
      answered: sortedMembers(answered),
      scores: scores.map((e) => [e.value, e.score]).sort(),
      correct,
      dist,
      disp,
      feed,
      dirtySlides,
      dirty: Boolean(dirty),
      ttlSet: ttl > 0,
    };
  },
};

const fakeBackend = (fake: FakeRedis): Harness => ({
  async seed(sid, slideId, options = {}) {
    await fake.hSet(k.meta(sid), 'status', options.status ?? 'active');
    await fake.hSet(k.slides(sid), slideId, windowJson(slideId, options.window));
    await fake.hSet(k.tokens(sid), options.participants ?? tokens);
    for (const id of options.kicked ?? []) await fake.sAdd(k.kicked(sid), id);
  },
  async run(call) {
    const raw = runFakeAnswerScript(fake, scriptKeys(call), scriptArguments(call));
    const status = String(raw[0]);
    if (status === 'OK') return { status: 'OK', answeredCount: Number(raw[1]), ownsDirtyWindow: Number(raw[2]) === 1 };
    if (status === 'DUP') return { status: 'DUP', storedJson: String(raw[1]), answeredCount: Number(raw[2]) };
    return { status } as AnswerScriptReply;
  },
  async dump(sid, slideId) {
    const scores = await fake.zRangeWithScores(k.scores(sid), 0, -1);
    return {
      results: Object.keys(await fake.hGetAll(k.results(sid, slideId))).sort(),
      answered: sortedMembers(await fake.sMembers(k.answered(sid, slideId))),
      scores: scores.map((e) => [e.value, e.score]).sort(),
      correct: await fake.hGetAll(k.correct(sid)),
      dist: await fake.hGetAll(k.dist(sid, slideId)),
      disp: await fake.hGetAll(k.disp(sid, slideId)),
      feed: await fake.lRange(k.feed(sid, slideId), 0, -1),
      dirtySlides: await fake.sMembers(k.dirtySlides(sid)),
      dirty: fake.store.has(k.dirty(sid)),
      ttlSet: fake.ttls.has(k.answered(sid, slideId)),
    };
  },
});

describeIntegration('answer script (real Redis)', () => {
  const sessions: string[] = [];
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  afterAll(async () => {
    for (const sid of sessions) {
      for await (const batch of redisClient.scanIterator({ MATCH: `psess:{${sid}}:*` })) {
        if (batch.length) await redisClient.del(batch);
      }
    }
    await server?.close();
  });

  for (const scenario of scenarios) {
    it(`matches the JS port: ${scenario.name}`, async () => {
      const ids = { sid: oid(), slideId: oid() };
      sessions.push(ids.sid);
      const real = await tryEach(scenario.name, realBackend, scenario, ids);
      const fake = await tryEach(scenario.name, fakeBackend(new FakeRedis()), scenario, ids);
      expect(real.replies).toEqual(fake.replies);
      expect(real.state).toEqual(fake.state);
    });
  }

  it('replies the way the contract says', async () => {
    const sid = oid();
    const slideId = oid();
    sessions.push(sid);
    await realBackend.seed(sid, slideId);
    const first = await realBackend.run(input(sid, slideId, P[0]!));
    expect(first).toEqual({ status: 'OK', answeredCount: 1, ownsDirtyWindow: true });
    const second = await realBackend.run(input(sid, slideId, P[1]!));
    expect(second).toEqual({ status: 'OK', answeredCount: 2, ownsDirtyWindow: false });
    const dup = await realBackend.run(input(sid, slideId, P[0]!, { score: 77 }));
    expect(dup).toMatchObject({ status: 'DUP', answeredCount: 2 });
    expect(JSON.parse((dup as { storedJson: string }).storedJson)).toMatchObject({ clientAnswerId: `c-${P[0]}` });
    expect(await redisClient.zScore(k.scores(sid), P[0]!)).toBe(100);
  });

  it('keeps the dedup atomic and the counters exact under a burst', async () => {
    const sid = oid();
    const slideId = oid();
    sessions.push(sid);
    const crowd = Array.from({ length: 150 }, () => oid());
    await realBackend.seed(sid, slideId, { participants: Object.fromEntries(crowd.map((id) => [id, `token-${id}`])) });

    // 150 participants answer at once; every one of them also fires the same answer twice more.
    const replies = await Promise.all(
      crowd.flatMap((id, index) =>
        [0, 1, 2].map((_) =>
          realBackend.run(input(sid, slideId, id, { ops: [{ op: 'hincrby', key: 'dist', field: String(index % 3), by: 1 }] }))
        )
      )
    );
    expect(replies.filter((r) => r.status === 'OK')).toHaveLength(150);
    expect(replies.filter((r) => r.status === 'DUP')).toHaveLength(300);
    expect(replies.filter((r) => r.status === 'OK' && (r as { ownsDirtyWindow: boolean }).ownsDirtyWindow)).toHaveLength(1);

    expect(await redisClient.sCard(k.answered(sid, slideId))).toBe(150);
    expect(await redisClient.hLen(k.results(sid, slideId))).toBe(150);
    expect(await redisClient.hGetAll(k.dist(sid, slideId))).toEqual({ '0': '50', '1': '50', '2': '50' });
    const board = await redisClient.zRangeWithScores(k.scores(sid), 0, -1);
    expect(board.reduce((sum, e) => sum + e.score, 0)).toBe(150 * 100);
    expect(await redisClient.hGet(k.correct(sid), crowd[0]!)).toBe('1');
  });

  it('refuses the 31st attempt of one participant inside the window, and counts nothing for it', async () => {
    const sid = oid();
    const slideId = oid();
    sessions.push(sid);
    await realBackend.seed(sid, slideId);
    const statuses: string[] = [];
    for (let i = 0; i < 32; i += 1) statuses.push((await realBackend.run(input(sid, slideId, P[0]!))).status);
    expect(statuses[0]).toBe('OK');
    expect(statuses.slice(1, 30).every((s) => s === 'DUP')).toBe(true);
    expect(statuses.slice(30)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    expect(await redisClient.sCard(k.answered(sid, slideId))).toBe(1);
  });

  it('recovers when the script cache is flushed (EVALSHA falls back to EVAL)', async () => {
    const sid = oid();
    const slideId = oid();
    sessions.push(sid);
    await realBackend.seed(sid, slideId);
    await redisClient.scriptFlush();
    expect((await realBackend.run(input(sid, slideId, P[0]!))).status).toBe('OK');
    await redisClient.scriptFlush();
    expect((await realBackend.run(input(sid, slideId, P[1]!))).status).toBe('OK');
  });
});
