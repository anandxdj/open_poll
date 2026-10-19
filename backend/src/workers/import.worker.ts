import { hostname } from 'node:os';
import { Types } from 'mongoose';
import { audit } from '../common/audit/audit';
import { redisClient } from '../common/config/redis';
import { asImportError, ImportError } from '../modules/imports/errors';
import { ImportJobModel, type IImportJob } from '../modules/imports/import.model';
import { runImportJob, type PipelineDeps } from '../modules/imports/pipeline';
import {
  dropDriveToken,
  enqueueImport,
  finishImport,
  importKeys,
  isQueued,
  leaseImport,
  renewImportLease,
  requeueImport,
  takeNextImport,
  type RedisLike,
} from '../modules/imports/queue';
import { WorkspaceModel } from '../modules/workspaces/workspace.model';

/**
 * Import worker: takes job ids from the Redis queue (`BLMOVE` into a
 * processing list), runs them (`modules/imports/pipeline.ts`) and keeps the
 * queue honest.
 *
 * Lifecycle of a job: `queued` → `running` → `completed` | `failed`.
 * - A worker leases the job in Redis (TTL = visibility timeout) and renews the
 *   lease while it works. A crash lets the lease expire.
 * - The reaper (one at a time across instances) finds ids in `processing`
 *   whose lease has been gone for the grace period and puts them back in the
 *   queue; once a job has been claimed `maxAttempts` times it is failed with
 *   a readable message instead. It also re-queues jobs Redis forgot (a
 *   flushed or restored Redis) from the Mongo records.
 * - A job that fails with a problem the user can fix (`ImportError`, a 4xx
 *   `ApiError`) fails at once; anything else is retried up to `maxAttempts`.
 *
 * Topology: `IMPORT_WORKER_INPROCESS` (default on) runs consumers inside the
 * API process (`startJobs()`); set it to 0 on API instances and run
 * `bun run worker:import` (this file) elsewhere to isolate the CPU-heavy
 * parsing and rendering. `IMPORT_WORKER_CONCURRENCY` (default 1, max 4)
 * is the number of jobs one process runs at once.
 */

export interface ImportWorkerOptions {
  concurrency: number;
  /** Lease TTL; a worker renews it every third of this. */
  visibilityMs: number;
  /** An id without a lease must stay that way this long before it is taken back. */
  graceMs: number;
  /** Times a job may be claimed before it is failed instead of requeued. */
  maxAttempts: number;
  reapEveryMs: number;
  /** Jobs unfinished and silent this long, and absent from Redis, are re-queued from Mongo. */
  orphanAfterMs: number;
  /** BLMOVE timeout: how often an idle consumer checks whether to stop. */
  blockSeconds: number;
  /** How long stop() waits for running jobs. */
  stopTimeoutMs: number;
  instanceId: string;
  pipeline: PipelineDeps;
}

export const DEFAULT_WORKER_OPTIONS: ImportWorkerOptions = {
  concurrency: 1,
  visibilityMs: 120_000,
  graceMs: 30_000,
  maxAttempts: 3,
  reapEveryMs: 30_000,
  orphanAfterMs: 10 * 60_000,
  blockSeconds: 2,
  stopTimeoutMs: 20_000,
  instanceId: `${hostname()}:${process.pid}`,
  pipeline: {},
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERRUPTED = {
  code: 'IMPORT_INTERRUPTED',
  message: 'This import was interrupted several times and was stopped. Try again, and contact support if it keeps happening.',
};
const FAILED = {
  code: 'IMPORT_FAILED',
  message: 'The import could not be completed because of a problem on our side. Try again in a moment.',
};

export interface ReapResult {
  requeued: string[];
  failed: string[];
}

export class ImportWorker {
  readonly options: ImportWorkerOptions;
  private stopping = false;
  private running = false;
  private loops: Promise<void>[] = [];
  private blocking = new Set<ReturnType<typeof redisClient.duplicate>>();
  private active = new Set<Promise<void>>();
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;

  constructor(options: Partial<ImportWorkerOptions> = {}, private readonly client: RedisLike = redisClient) {
    this.options = { ...DEFAULT_WORKER_OPTIONS, ...options };
  }

  get isRunning() {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    for (let slot = 0; slot < this.options.concurrency; slot++) this.loops.push(this.consume(slot));
    if (this.options.reapEveryMs > 0) {
      this.reaperTimer = setInterval(() => void this.reapOnce().catch((e) => console.error('[Imports] Reaper failed:', e?.message)), this.options.reapEveryMs);
      this.reaperTimer.unref?.();
    }
  }

  /** Stops taking jobs and waits (up to `stopTimeoutMs`) for running ones. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.stopping = true;
    if (this.reaperTimer) clearInterval(this.reaperTimer);
    this.reaperTimer = null;
    // Unblocks BLMOVE waits; a running job uses its own connection.
    for (const client of this.blocking) client.destroy();
    await Promise.race([Promise.allSettled([...this.active]), sleep(this.options.stopTimeoutMs)]);
    await Promise.race([Promise.allSettled(this.loops), sleep(1000)]);
    this.loops = [];
    this.blocking.clear();
    this.running = false;
  }

  // ---------- Consuming ----------

  private async consume(slot: number): Promise<void> {
    const connection = redisClient.duplicate();
    connection.on('error', () => {});
    this.blocking.add(connection);
    try {
      await connection.connect();
    } catch (error) {
      console.error(`[Imports] Worker ${slot} could not connect to Redis:`, (error as Error)?.message);
      this.blocking.delete(connection);
      return;
    }
    while (!this.stopping) {
      let id: string | null = null;
      try {
        id = await takeNextImport(connection as unknown as RedisLike, this.options.blockSeconds);
      } catch (error) {
        if (this.stopping) break;
        console.error('[Imports] Queue read failed:', (error as Error)?.message);
        await sleep(1000);
        if (!connection.isOpen) break;
        continue;
      }
      if (!id) continue;
      const work = this.handle(id).catch((error) => console.error('[Imports] Job handler crashed:', error));
      this.active.add(work);
      await work;
      this.active.delete(work);
    }
    this.blocking.delete(connection);
    if (connection.isOpen) connection.destroy();
  }

  /** Runs one job taken from the queue. */
  async handle(jobId: string): Promise<void> {
    const owner = `${this.options.instanceId}:${++this.seq}`;
    // Lease first: the id is in `processing` now and must not look abandoned.
    await leaseImport(jobId, owner, this.options.visibilityMs, this.client);

    const now = new Date();
    const job = await ImportJobModel.findOneAndUpdate(
      { _id: jobId, status: { $in: ['queued', 'running'] } },
      { $set: { status: 'running', leaseOwner: owner, heartbeatAt: now, startedAt: now, stage: null }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    );
    if (!job) {
      // Finished, deleted or unknown: nothing to run.
      await finishImport(jobId, this.client);
      return;
    }
    if (job.attempts > this.options.maxAttempts) {
      await this.fail(job, owner, INTERRUPTED);
      return;
    }
    if (!job.resultPresentationId) {
      // Reserve the deck id before any work: a retry after a crash creates the same deck, never a second one.
      const reserved = new Types.ObjectId();
      await ImportJobModel.updateOne({ _id: job._id, resultPresentationId: null }, { $set: { resultPresentationId: reserved } });
      job.resultPresentationId = (await ImportJobModel.findById(job._id).select('resultPresentationId'))?.resultPresentationId ?? reserved;
    }

    const beat = setInterval(() => {
      void (async () => {
        try {
          const renewed = await renewImportLease(jobId, this.options.visibilityMs, this.client);
          if (!renewed) await leaseImport(jobId, owner, this.options.visibilityMs, this.client);
          await ImportJobModel.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { heartbeatAt: new Date() } });
        } catch (error) {
          console.error('[Imports] Heartbeat failed:', (error as Error)?.message);
        }
      })();
    }, Math.max(50, Math.floor(this.options.visibilityMs / 3)));
    beat.unref?.();

    try {
      const result = await runImportJob(job, {
        ...this.options.pipeline,
        stage: async (stage) => {
          await ImportJobModel.updateOne({ _id: job._id, leaseOwner: owner }, { $set: { stage, heartbeatAt: new Date() } });
        },
      });
      await ImportJobModel.updateOne(
        { _id: job._id, leaseOwner: owner },
        {
          $set: {
            status: 'completed',
            resultPresentationId: result.presentationId,
            warnings: result.warnings,
            error: null,
            stage: null,
            finishedAt: new Date(),
            leaseOwner: null,
          },
        },
      );
      const workspace = await WorkspaceModel.findById(job.workspaceId);
      void audit(
        { actorType: 'system', actorId: job.userId, workspace },
        'import.complete',
        { type: 'presentation', id: result.presentationId },
        { kind: job.kind, slides: result.slideCount, warnings: result.warnings.length },
      );
      await dropDriveToken(jobId, this.client);
      await finishImport(jobId, this.client);
    } catch (error) {
      clearInterval(beat);
      await this.onError(job, owner, error);
      return;
    } finally {
      clearInterval(beat);
    }
  }

  private async onError(job: IImportJob, owner: string, error: unknown): Promise<void> {
    const jobId = String(job._id);
    const known = asImportError(error);
    if (known) {
      await this.fail(job, owner, { code: known.code, message: known.message });
      return;
    }
    console.error(`[Imports] Job ${jobId} failed (attempt ${job.attempts}/${this.options.maxAttempts}):`, error);
    if (job.attempts >= this.options.maxAttempts) {
      await this.fail(job, owner, FAILED);
      return;
    }
    const requeued = await ImportJobModel.updateOne(
      { _id: job._id, leaseOwner: owner },
      { $set: { status: 'queued', leaseOwner: null, stage: null } },
    );
    if (requeued.modifiedCount === 1) await requeueImport(jobId, this.client);
    else await finishImport(jobId, this.client);
  }

  private async fail(job: IImportJob, owner: string, error: { code: string; message: string }): Promise<void> {
    const jobId = String(job._id);
    await ImportJobModel.updateOne(
      { _id: job._id, $or: [{ leaseOwner: owner }, { leaseOwner: null }] },
      { $set: { status: 'failed', error, stage: null, finishedAt: new Date(), leaseOwner: null } },
    );
    await dropDriveToken(jobId, this.client).catch(() => {});
    await finishImport(jobId, this.client);
  }

  // ---------- Reaping ----------

  /**
   * One pass of the reaper. Takes a short Redis lock so that, across all
   * instances, one pass runs at a time. Returns what it touched.
   */
  async reapOnce(now = Date.now()): Promise<ReapResult> {
    const result: ReapResult = { requeued: [], failed: [] };
    const lockMs = Math.max(1000, Math.floor(this.options.reapEveryMs * 0.8));
    const locked = await this.client.set(importKeys.reaperLock, this.options.instanceId, { NX: true, PX: lockMs });
    if (locked !== 'OK') return result;

    // 1. Ids a dead worker left in `processing`.
    const processing = await this.client.lRange(importKeys.processing, 0, -1);
    const firstSeen = await this.client.hGetAll(importKeys.suspects);
    for (const id of processing) {
      if ((await this.client.exists(importKeys.lease(id))) === 1) {
        if (firstSeen[id]) await this.client.hDel(importKeys.suspects, id);
        continue;
      }
      await this.client.hSetNX(importKeys.suspects, id, String(now));
      const seen = Number(firstSeen[id] ?? now);
      if (now - seen >= this.options.graceMs) await this.reclaim(id, result);
    }
    // Forget suspects that left the processing list on their own.
    for (const id of Object.keys(firstSeen)) if (!processing.includes(id)) await this.client.hDel(importKeys.suspects, id);

    // 2. Jobs Mongo says are unfinished but Redis lost entirely.
    const cutoff = new Date(now - this.options.orphanAfterMs);
    const orphans = await ImportJobModel.find({
      $or: [
        { status: 'queued', queuedAt: { $lt: cutoff } },
        { status: 'running', heartbeatAt: { $lt: cutoff } },
      ],
    })
      .select('_id')
      .limit(100)
      .lean();
    for (const orphan of orphans) {
      const id = String(orphan._id);
      if (!(await isQueued(id, this.client))) await this.reclaim(id, result);
    }
    return result;
  }

  /** Puts an abandoned job back in the queue, or fails it when it has used its attempts. */
  private async reclaim(jobId: string, result: ReapResult): Promise<void> {
    const job = await ImportJobModel.findById(jobId);
    if (!job || job.status === 'completed' || job.status === 'failed') {
      await finishImport(jobId, this.client);
      return;
    }
    if (job.attempts >= this.options.maxAttempts) {
      await ImportJobModel.updateOne(
        { _id: job._id, status: { $in: ['queued', 'running'] } },
        { $set: { status: 'failed', error: INTERRUPTED, stage: null, finishedAt: new Date(), leaseOwner: null } },
      );
      await dropDriveToken(jobId, this.client).catch(() => {});
      await finishImport(jobId, this.client);
      result.failed.push(jobId);
      return;
    }
    await ImportJobModel.updateOne(
      { _id: job._id, status: { $in: ['queued', 'running'] } },
      { $set: { status: 'queued', leaseOwner: null, stage: null, queuedAt: new Date() } },
    );
    await requeueImport(jobId, this.client);
    result.requeued.push(jobId);
  }
}

// ---------- Process wiring ----------

/** IMPORT_WORKER_INPROCESS: on unless set to 0/false/no/off. */
export const importWorkerInProcess = (value = process.env.IMPORT_WORKER_INPROCESS) =>
  !['0', 'false', 'no', 'off'].includes((value ?? '').trim().toLowerCase());

const concurrencyFromEnv = () => {
  const parsed = Number.parseInt(process.env.IMPORT_WORKER_CONCURRENCY ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(4, Math.max(1, parsed)) : 1;
};

let instance: ImportWorker | null = null;

/** Starts the in-process worker (called by `startJobs()`); a no-op when IMPORT_WORKER_INPROCESS=0. */
export function startImportWorker(options: Partial<ImportWorkerOptions> = {}, force = false): ImportWorker | null {
  if (instance?.isRunning) return instance;
  if (!force && !importWorkerInProcess()) return null;
  instance = new ImportWorker({ concurrency: concurrencyFromEnv(), ...options });
  instance.start();
  return instance;
}

export async function stopImportWorker(): Promise<void> {
  const current = instance;
  instance = null;
  await current?.stop();
}

export { ImportError };

// Standalone process: `bun run worker:import`.
if (import.meta.main) {
  const { connectDB } = await import('../common/config/db');
  const { connectRedis } = await import('../common/config/redis');
  await connectDB();
  await connectRedis();
  const worker = startImportWorker({}, true)!;
  console.log(`[Imports] Worker started (concurrency ${worker.options.concurrency})`);
  const shutdown = async () => {
    await stopImportWorker();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}
