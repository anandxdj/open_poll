import type { FakeRedis } from './harness';

/**
 * A line-by-line JS port of `src/modules/presentations/live/lua/answer.lua`,
 * run by `FakeRedis.eval` so the unit tests exercise the real answer service
 * without a Redis server. The Lua itself is exercised against a real Redis by
 * `tests/integration/answerScript.test.ts`, which also replays the same
 * scenarios through this port and requires identical replies and state — so
 * the two cannot drift apart unnoticed.
 */

type Reply = (string | number)[];

const expired = (until: Map<string, number>, key: string) => {
  const at = until.get(key);
  return at !== undefined && Date.now() >= at;
};

/** PX/PEXPIRE deadlines, per FakeRedis (the fake has no real clock-driven expiry). */
const deadlines = new WeakMap<FakeRedis, Map<string, number>>();
const deadlinesOf = (redis: FakeRedis) => {
  let map = deadlines.get(redis);
  if (!map) deadlines.set(redis, (map = new Map()));
  return map;
};

export const runFakeAnswerScript = (redis: FakeRedis, keys: string[], argv: string[]): Reply => {
  const [meta, slides, kicked, tokens, answered, results, scores, correct, rate, dirty, dirtySlides, dist, disp, feed] =
    keys as [string, string, string, string, string, string, string, string, string, string, string, string, string, string];
  const until = deadlinesOf(redis);

  const hget = (key: string, field: string) => redis.read(key, 'hash')?.value.get(field) ?? null;
  const hash = (key: string) => redis.ensure(key, 'hash').value;
  const has = (key: string, member: string) => redis.read(key, 'set')?.value.has(member) ?? false;
  const card = (key: string) => redis.read(key, 'set')?.value.size ?? 0;

  const pid = argv[0]!;
  const slideId = argv[2]!;
  const slideIndex = Number(argv[3]);
  const startedAt = Number(argv[4]);
  const now = Number(argv[5]);
  const ticketOk = argv[6] === '1';
  const isCorrect = argv[8] === '1';

  // 1. window
  const rawWindow = hget(slides, slideId);
  if (rawWindow === null) return ['NO_WINDOW'];
  const window = JSON.parse(rawWindow) as { slideIndex: number; startedAtMs: number; open: boolean; endsAtMs: number | null };
  if (window.slideIndex !== slideIndex || window.startedAtMs !== startedAt) return ['STALE'];

  // 2. who
  const storedToken = hget(tokens, pid);
  if (storedToken === null) return ['NO_TOKEN'];
  if (storedToken !== argv[1]) return ['BAD_TOKEN'];
  if (has(kicked, pid)) return ['KICKED'];

  // 3. rate
  if (expired(until, rate)) {
    redis.store.delete(rate);
    until.delete(rate);
  }
  const attempts = incr(redis, rate);
  if (attempts === 1) until.set(rate, Date.now() + Number(argv[12]));
  if (attempts > Number(argv[11])) return ['RATE_LIMITED'];

  // 4. dup
  if (has(answered, pid)) return ['DUP', hget(results, pid) ?? '', card(answered)];

  // 5. window state
  if (hget(meta, 'status') === 'ended') return ['CLOSED'];
  if (!window.open) return ['CLOSED'];
  if (window.endsAtMs !== null && window.endsAtMs !== undefined) {
    const grace = ticketOk ? Number(argv[16]) : Number(argv[15]);
    if (now > window.endsAtMs + grace) return ['TIME_UP'];
  }

  // 6. ops
  const ops = JSON.parse(argv[10]!) as { op: string; key: string; field?: string; by?: number; value?: string; max?: number }[];
  const targets: Record<string, string> = { dist, disp, feed };
  for (const op of ops) {
    if (targets[op.key] === undefined) return ['BAD_OP'];
    if (op.op !== 'hincrby' && op.op !== 'hsetnx' && op.op !== 'lpush_trim') return ['BAD_OP'];
  }

  // 7. apply
  redis.ensure(answered, 'set').value.add(pid);
  const board = redis.ensure(scores, 'zset').value;
  board.set(pid, (board.get(pid) ?? 0) + Number(argv[7]));
  if (isCorrect) hash(correct).set(pid, String(Number(hash(correct).get(pid) ?? 0) + 1));
  const touched = [answered, results, scores, correct];
  for (const op of ops) {
    const key = targets[op.key]!;
    if (op.op === 'hincrby') {
      const target = hash(key);
      target.set(op.field!, String(Number(target.get(op.field!) ?? 0) + op.by!));
    } else if (op.op === 'hsetnx') {
      const target = hash(key);
      if (!target.has(op.field!)) target.set(op.field!, op.value!);
    } else {
      const entry = redis.ensure(key, 'list');
      entry.value.unshift(op.value!);
      entry.value = entry.value.slice(0, op.max!);
    }
    touched.push(key);
  }
  hash(results).set(pid, argv[9]!);
  for (const key of touched) redis.ttls.set(key, Number(argv[14]));

  // 8. coalescer
  redis.ensure(dirtySlides, 'set').value.add(slideId);
  redis.ttls.set(dirtySlides, 60);
  let owns = 0;
  if (expired(until, dirty)) {
    redis.store.delete(dirty);
    until.delete(dirty);
  }
  if (!redis.store.has(dirty)) {
    redis.store.set(dirty, { type: 'string', value: '1' });
    until.set(dirty, Date.now() + Number(argv[13]));
    owns = 1;
  }
  return ['OK', card(answered), owns];
};

const incr = (redis: FakeRedis, key: string) => {
  const entry = redis.ensure(key, 'string');
  entry.value = String(Number(entry.value || 0) + 1);
  return Number(entry.value);
};
