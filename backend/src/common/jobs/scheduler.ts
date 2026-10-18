import { randomUUID } from 'node:crypto';
import { redisClient } from '../config/redis';

/**
 * Cluster-wide periodic jobs. Time is cut into ticks of `everyMs` aligned to
 * the epoch; every instance wakes at each tick boundary and races for a Redis
 * `SET NX PX` lock named after the job and tick, so exactly one instance runs
 * each tick. A second lock (held for the duration of the run) keeps a slow run
 * from overlapping the next tick anywhere in the cluster; that tick is skipped.
 *
 * Jobs must be idempotent: a tick is skipped, never retried, when Redis is
 * unavailable or the previous run is still going.
 */

export interface JobContext {
  name: string;
  /** Tick number (floor(now / everyMs)). */
  tick: number;
  /** Aborted when the scheduler stops; long jobs should check it between batches. */
  signal: AbortSignal;
}

export interface JobDefinition {
  name: string;
  everyMs: number;
  run: (context: JobContext) => Promise<void> | void;
  /** Upper bound on one run; the overlap lock expires after it. Default 10 × everyMs, at least 1 min. */
  maxRunMs?: number;
}

/** The lock primitives the scheduler needs; Redis in production, in-memory in unit tests. */
export interface JobLockStore {
  /** SET key token NX PX ttlMs: true when this caller took the lock. */
  acquire(key: string, token: string, ttlMs: number): Promise<boolean>;
  /** Deletes the key only if it still holds `token`. */
  release(key: string, token: string): Promise<void>;
}

const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

type RedisLike = Pick<typeof redisClient, 'set' | 'eval'>;

export function redisLockStore(client: RedisLike = redisClient): JobLockStore {
  return {
    async acquire(key, token, ttlMs) {
      const reply = await client.set(key, token, { condition: 'NX', expiration: { type: 'PX', value: ttlMs } });
      return reply === 'OK';
    },
    async release(key, token) {
      await client.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] });
    },
  };
}

const registry = new Map<string, JobDefinition>();

/** Registers a job for startScheduler(). Names are unique; call at module load. */
export function registerJob(definition: JobDefinition): void {
  if (!/^[a-z0-9][a-z0-9:_-]*$/i.test(definition.name)) throw new Error(`Invalid job name "${definition.name}"`);
  if (!Number.isFinite(definition.everyMs) || definition.everyMs < 1000) {
    throw new Error(`Job "${definition.name}" needs everyMs >= 1000`);
  }
  if (registry.has(definition.name)) throw new Error(`Job "${definition.name}" is already registered`);
  registry.set(definition.name, definition);
}

export const registeredJobs = (): JobDefinition[] => [...registry.values()];

export interface SchedulerOptions {
  jobs?: JobDefinition[];
  store?: JobLockStore;
  /** Identifies this instance in lock values (debugging). */
  instanceId?: string;
  now?: () => number;
  log?: Pick<Console, 'error' | 'log'>;
}

export const tickLockKey = (name: string, tick: number) => `jobs:{${name}}:tick:${tick}`;
export const runLockKey = (name: string) => `jobs:{${name}}:running`;

export class Scheduler {
  private readonly jobs: JobDefinition[];
  private readonly store: JobLockStore;
  private readonly instanceId: string;
  private readonly now: () => number;
  private readonly log: Pick<Console, 'error' | 'log'>;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<boolean>>();
  private readonly abort = new AbortController();
  private started = false;

  constructor(options: SchedulerOptions = {}) {
    this.jobs = options.jobs ?? registeredJobs();
    this.store = options.store ?? redisLockStore();
    this.instanceId = options.instanceId ?? randomUUID();
    this.now = options.now ?? Date.now;
    this.log = options.log ?? console;
  }

  /**
   * Attempts one tick of `job` now. Resolves true when this instance ran it,
   * false when another instance holds the tick, a run is still in progress, or
   * Redis failed. Never rejects: job errors are logged.
   */
  async runTick(job: JobDefinition, tick = Math.floor(this.now() / job.everyMs)): Promise<boolean> {
    if (this.running.has(job.name)) return false;
    const attempt = this.attempt(job, tick);
    this.running.set(job.name, attempt);
    try {
      return await attempt;
    } finally {
      this.running.delete(job.name);
    }
  }

  private async attempt(job: JobDefinition, tick: number): Promise<boolean> {
    const token = `${this.instanceId}:${tick}`;
    const runKey = runLockKey(job.name);
    const maxRunMs = job.maxRunMs ?? Math.max(job.everyMs * 10, 60_000);
    try {
      if (!(await this.store.acquire(runKey, token, maxRunMs))) return false;
    } catch (error) {
      this.log.error(`[Jobs] ${job.name}: lock unavailable, skipping tick ${tick}:`, (error as Error)?.message);
      return false;
    }

    try {
      // Kept for two ticks so an instance whose clock lags still sees it was taken.
      if (!(await this.store.acquire(tickLockKey(job.name, tick), token, job.everyMs * 2))) return false;
      try {
        await job.run({ name: job.name, tick, signal: this.abort.signal });
      } catch (error) {
        this.log.error(`[Jobs] ${job.name} tick ${tick} failed:`, error);
      }
      return true;
    } catch (error) {
      this.log.error(`[Jobs] ${job.name}: lock unavailable, skipping tick ${tick}:`, (error as Error)?.message);
      return false;
    } finally {
      await this.store
        .release(runKey, token)
        .catch((error) => this.log.error(`[Jobs] ${job.name}: failed to release run lock:`, (error as Error)?.message));
    }
  }

  start(): this {
    if (this.started) return this;
    this.started = true;
    for (const job of this.jobs) this.schedule(job);
    if (this.jobs.length > 0) {
      this.log.log(`[Jobs] Scheduler started: ${this.jobs.map((job) => `${job.name}/${job.everyMs}ms`).join(', ')}`);
    }
    return this;
  }

  private schedule(job: JobDefinition) {
    const now = this.now();
    // Wake just after the next tick boundary.
    const delay = job.everyMs - (now % job.everyMs) + 5;
    const timer = setTimeout(() => {
      if (!this.started) return;
      void this.runTick(job, Math.floor(this.now() / job.everyMs));
      this.schedule(job);
    }, delay);
    timer.unref?.();
    this.timers.set(job.name, timer);
  }

  /** Stops scheduling, aborts the signal given to running jobs and waits for them. */
  async stop(): Promise<void> {
    this.started = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.abort.abort();
    await Promise.allSettled(this.running.values());
  }
}

let defaultScheduler: Scheduler | null = null;

/**
 * Starts every registered job on this instance (idempotent). Needs a
 * long-lived process; one call per instance at boot, after Redis connects.
 */
export function startScheduler(options: Omit<SchedulerOptions, 'jobs'> = {}): Scheduler {
  if (!defaultScheduler) defaultScheduler = new Scheduler(options).start();
  return defaultScheduler;
}

export async function stopScheduler(): Promise<void> {
  const scheduler = defaultScheduler;
  defaultScheduler = null;
  await scheduler?.stop();
}
