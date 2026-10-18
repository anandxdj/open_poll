import { describe, expect, it } from 'bun:test';
import { Scheduler, registerJob, registeredJobs, type JobDefinition, type JobLockStore } from '../src/common/jobs/scheduler';

/** SET NX PX / compare-and-delete over a Map, shared by "instances" like one Redis would be. */
function memoryLockStore(now: () => number = Date.now): JobLockStore & { keys(): string[] } {
  const locks = new Map<string, { token: string; expiresAt: number }>();
  const live = (key: string) => {
    const lock = locks.get(key);
    if (lock && lock.expiresAt <= now()) locks.delete(key);
    return locks.get(key);
  };
  return {
    async acquire(key, token, ttlMs) {
      if (live(key)) return false;
      locks.set(key, { token, expiresAt: now() + ttlMs });
      return true;
    },
    async release(key, token) {
      if (live(key)?.token === token) locks.delete(key);
    },
    keys: () => [...locks.keys()],
  };
}

const quiet = { log: () => {}, error: () => {} };

describe('scheduler lock', () => {
  it('runs each tick once across two schedulers sharing the lock store', async () => {
    const runs: Array<{ instance: string; tick: number }> = [];
    const store = memoryLockStore();
    const job = (instance: string): JobDefinition => ({
      name: 'cleanup',
      everyMs: 60_000,
      run: async ({ tick }) => {
        runs.push({ instance, tick });
        await Bun.sleep(1);
      },
    });
    const a = new Scheduler({ jobs: [job('a')], store, instanceId: 'a', log: quiet });
    const b = new Scheduler({ jobs: [job('b')], store, instanceId: 'b', log: quiet });

    for (let tick = 100; tick < 110; tick += 1) {
      const results = await Promise.all([a.runTick(job('a'), tick), b.runTick(job('b'), tick)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    }
    expect(runs.map((run) => run.tick)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it('does not run a tick again after the other instance finished it', async () => {
    const store = memoryLockStore();
    let runs = 0;
    const job: JobDefinition = { name: 'digest', everyMs: 60_000, run: () => void (runs += 1) };
    const a = new Scheduler({ jobs: [job], store, instanceId: 'a', log: quiet });
    const b = new Scheduler({ jobs: [job], store, instanceId: 'b', log: quiet });
    expect(await a.runTick(job, 7)).toBe(true);
    // b's timer fires late (clock skew), after a released the run lock.
    expect(await b.runTick(job, 7)).toBe(false);
    expect(runs).toBe(1);
  });

  it('skips a tick anywhere in the cluster while the previous run is still going', async () => {
    const store = memoryLockStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ticks: number[] = [];
    const job: JobDefinition = {
      name: 'slow',
      everyMs: 60_000,
      run: async ({ tick }) => {
        ticks.push(tick);
        if (tick === 1) await gate;
      },
    };
    const a = new Scheduler({ jobs: [job], store, instanceId: 'a', log: quiet });
    const b = new Scheduler({ jobs: [job], store, instanceId: 'b', log: quiet });

    const slowRun = a.runTick(job, 1);
    await Bun.sleep(5);
    expect(await b.runTick(job, 2)).toBe(false);
    expect(await a.runTick(job, 2)).toBe(false);
    release();
    expect(await slowRun).toBe(true);
    expect(await b.runTick(job, 3)).toBe(true);
    expect(ticks).toEqual([1, 3]);
  });

  it('logs a failing job and keeps going', async () => {
    const errors: unknown[] = [];
    const store = memoryLockStore();
    const job: JobDefinition = {
      name: 'flaky',
      everyMs: 60_000,
      run: () => {
        throw new Error('boom');
      },
    };
    const scheduler = new Scheduler({ jobs: [job], store, log: { log: () => {}, error: (...args) => errors.push(args) } });
    expect(await scheduler.runTick(job, 1)).toBe(true);
    expect(errors).toHaveLength(1);
    // The run lock was released despite the error.
    expect(store.keys().some((key) => key.endsWith(':running'))).toBe(false);
  });

  it('skips the tick when the lock store is unavailable', async () => {
    let runs = 0;
    const broken: JobLockStore = {
      acquire: async () => {
        throw new Error('ECONNREFUSED');
      },
      release: async () => {},
    };
    const job: JobDefinition = { name: 'needs-redis', everyMs: 60_000, run: () => void (runs += 1) };
    const scheduler = new Scheduler({ jobs: [job], store: broken, log: quiet });
    expect(await scheduler.runTick(job, 1)).toBe(false);
    expect(runs).toBe(0);
  });

  it('with real timers, two started schedulers run each elapsed tick once', async () => {
    const store = memoryLockStore();
    const ticks: number[] = [];
    const job: JobDefinition = { name: 'timer', everyMs: 40, run: ({ tick }) => void ticks.push(tick) };
    const a = new Scheduler({ jobs: [job], store, instanceId: 'a', log: quiet }).start();
    const b = new Scheduler({ jobs: [job], store, instanceId: 'b', log: quiet }).start();
    await Bun.sleep(300);
    await Promise.all([a.stop(), b.stop()]);

    expect(ticks.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ticks).size).toBe(ticks.length);
  });
});

describe('registerJob', () => {
  it('validates names and intervals and rejects duplicates', () => {
    const run = () => {};
    registerJob({ name: 'platform-test-job', everyMs: 60_000, run });
    expect(registeredJobs().some((job) => job.name === 'platform-test-job')).toBe(true);
    expect(() => registerJob({ name: 'platform-test-job', everyMs: 60_000, run })).toThrow('already registered');
    expect(() => registerJob({ name: 'too-fast', everyMs: 10, run })).toThrow('everyMs');
    expect(() => registerJob({ name: 'bad name', everyMs: 60_000, run })).toThrow('Invalid job name');
  });
});
