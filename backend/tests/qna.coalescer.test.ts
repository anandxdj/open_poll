import { describe, expect, it } from 'bun:test';
import { COALESCE_WINDOW_MS, hashCoalescer, setCoalescer, type EvalClient } from '../src/modules/qna/coalescer';

/**
 * An in-memory stand-in for the coalescer's four Lua scripts (told apart by
 * the Redis command they use). The real scripts run against Redis in
 * tests/integration/qna.test.ts; here the scheduling logic is under test.
 */
class FakeRedis implements EvalClient {
  sets = new Map<string, Set<string>>();
  hashes = new Map<string, Map<string, number>>();
  locks = new Set<string>();
  counters = new Map<string, number>();
  calls: { keys: string[]; arguments: string[] }[] = [];

  async eval(script: string, { keys, arguments: args }: { keys: string[]; arguments: string[] }) {
    this.calls.push({ keys, arguments: args });
    if (script.includes("redis.call('SADD'")) {
      const set = this.sets.get(keys[0]!) ?? new Set<string>();
      set.add(args[0]!);
      this.sets.set(keys[0]!, set);
      return this.takeLock(keys[1]!);
    }
    if (script.includes('SMEMBERS')) {
      const members = [...(this.sets.get(keys[0]!) ?? [])];
      this.sets.delete(keys[0]!);
      this.locks.delete(keys[1]!);
      return members;
    }
    if (script.includes('HINCRBY')) {
      if (keys[2]) {
        const used = (this.counters.get(keys[2]) ?? 0) + 1;
        this.counters.set(keys[2], used);
        if (used > Number(args[4])) return -1;
      }
      const hash = this.hashes.get(keys[0]!) ?? new Map<string, number>();
      hash.set(args[0]!, (hash.get(args[0]!) ?? 0) + Number(args[1]));
      this.hashes.set(keys[0]!, hash);
      return this.takeLock(keys[1]!);
    }
    if (script.includes('HGETALL')) {
      const flat: string[] = [];
      for (const [field, value] of this.hashes.get(keys[0]!) ?? []) flat.push(field, String(value));
      this.hashes.delete(keys[0]!);
      this.locks.delete(keys[1]!);
      return flat;
    }
    throw new Error('unexpected script');
  }

  private takeLock(key: string) {
    if (this.locks.has(key)) return 0;
    this.locks.add(key);
    return 1;
  }
}

/** Collects scheduled flushes so a test fires them by hand. */
const manualClock = () => {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    schedule: (fn: () => void, ms: number) => void pending.push({ fn, ms }),
    pending,
    async fire() {
      const due = pending.splice(0);
      for (const { fn } of due) fn();
      // runFlush is async; let it settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
};

const KEYS = { data: 'qna:{s1}:votes:dirty', lock: 'qna:{s1}:votes:lock' };

describe('setCoalescer', () => {
  it('schedules one flush per window and flushes every member once', async () => {
    const client = new FakeRedis();
    const clock = manualClock();
    const flushed: string[][] = [];
    const coalescer = setCoalescer({
      keys: KEYS,
      ttlSec: 60,
      client,
      schedule: clock.schedule,
      flush: (ids) => void flushed.push(ids),
    });

    expect(await coalescer.mark('q1')).toBe(true);
    expect(await coalescer.mark('q2')).toBe(false);
    expect(await coalescer.mark('q1')).toBe(false);
    expect(clock.pending).toHaveLength(1);
    expect(clock.pending[0]!.ms).toBe(COALESCE_WINDOW_MS);

    await clock.fire();
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.sort()).toEqual(['q1', 'q2']);

    // The flush released the lock: the next change opens a new window.
    expect(await coalescer.mark('q3')).toBe(true);
    await clock.fire();
    expect(flushed.map((batch) => batch.sort())).toEqual([['q1', 'q2'], ['q3']]);
  });

  it('passes the ttl and window to the script and never flushes an empty batch', async () => {
    const client = new FakeRedis();
    const clock = manualClock();
    let flushes = 0;
    const coalescer = setCoalescer({ keys: KEYS, ttlSec: 123, windowMs: 250, client, schedule: clock.schedule, flush: () => void flushes++ });
    await coalescer.mark('q1');
    expect(client.calls[0]).toEqual({ keys: [KEYS.data, KEYS.lock], arguments: ['q1', '123', '250'] });
    expect(clock.pending[0]!.ms).toBe(250);

    // Something else drained the set before the timer fired.
    client.sets.clear();
    await clock.fire();
    expect(flushes).toBe(0);
  });

  it('a failing flush is logged, not thrown, and does not wedge the next window', async () => {
    const client = new FakeRedis();
    const clock = manualClock();
    const original = console.error;
    console.error = () => {};
    try {
      const coalescer = setCoalescer({
        keys: KEYS,
        ttlSec: 60,
        client,
        schedule: clock.schedule,
        flush: () => {
          throw new Error('publish failed');
        },
      });
      await coalescer.mark('q1');
      await clock.fire();
      expect(await coalescer.mark('q2')).toBe(true);
    } finally {
      console.error = original;
    }
  });
});

describe('hashCoalescer', () => {
  const HASH_KEYS = { data: 'reactions:{s1}:pending', lock: 'reactions:{s1}:lock' };
  const RATE = { key: 'reactions:{s1}:rate', max: 3, windowSec: 1 };

  it('sums counts per field into one flush per window', async () => {
    const client = new FakeRedis();
    const clock = manualClock();
    const flushed: Record<string, number>[] = [];
    const coalescer = hashCoalescer({ keys: HASH_KEYS, ttlSec: 60, client, schedule: clock.schedule, flush: (c) => void flushed.push(c) });

    expect(await coalescer.add('👍')).toBe('scheduled');
    expect(await coalescer.add('👍')).toBe('queued');
    expect(await coalescer.add('❤️', 2)).toBe('queued');
    expect(clock.pending).toHaveLength(1);

    await clock.fire();
    expect(flushed).toEqual([{ '👍': 2, '❤️': 2 }]);
  });

  it('maps the script result: over the rate limit records nothing', async () => {
    const client = new FakeRedis();
    const clock = manualClock();
    const flushed: Record<string, number>[] = [];
    const coalescer = hashCoalescer({ keys: HASH_KEYS, ttlSec: 60, client, schedule: clock.schedule, flush: (c) => void flushed.push(c) });

    expect(await coalescer.add('👍', 1, RATE)).toBe('scheduled');
    expect(await coalescer.add('👍', 1, RATE)).toBe('queued');
    expect(await coalescer.add('👍', 1, RATE)).toBe('queued');
    expect(await coalescer.add('👍', 1, RATE)).toBe('limited');
    // The rate key travels as KEYS[3], max and window as ARGV[5], ARGV[6].
    expect(client.calls[0]).toEqual({
      keys: [HASH_KEYS.data, HASH_KEYS.lock, RATE.key],
      arguments: ['👍', '1', '60', String(COALESCE_WINDOW_MS), '3', '1'],
    });

    await clock.fire();
    expect(flushed).toEqual([{ '👍': 3 }]);
  });

  it('drops non-positive counts when draining', async () => {
    const client = new FakeRedis();
    const clock = manualClock();
    const flushed: Record<string, number>[] = [];
    const coalescer = hashCoalescer({ keys: HASH_KEYS, ttlSec: 60, client, schedule: clock.schedule, flush: (c) => void flushed.push(c) });
    await coalescer.add('👍', 1);
    await coalescer.add('😮', -1);
    await coalescer.add('😮', 0);
    await clock.fire();
    expect(flushed).toEqual([{ '👍': 1 }]);
  });
});
