import type { RedisClientType } from 'redis';
import { redisClient } from '../../common/config/redis';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '../../common/utils/crypto';

/**
 * The import queue in Redis.
 *
 * - `pending`: job ids waiting (LPUSH in, oldest taken from the right).
 * - `processing`: ids a worker has taken (BLMOVE moves an id from pending to
 *   here in one step, so a worker that dies right after taking a job loses
 *   nothing).
 * - `lease:<id>`: set by the worker that runs the job, with a TTL it keeps
 *   renewing. An id in `processing` without a lease belongs to a dead worker;
 *   the reaper (import.worker.ts) puts it back or fails it.
 * - `token:<id>`: a Google access token for one Drive import, short-lived.
 *
 * All keys share the `{imports}` hash tag so the multi-key commands work on a
 * Redis Cluster. Job state lives in Mongo (ImportJob); Redis only says who
 * should run what.
 */

export type RedisLike = Pick<
  RedisClientType,
  'lPush' | 'blMove' | 'lRem' | 'lRange' | 'lPos' | 'set' | 'get' | 'del' | 'pExpire' | 'exists' | 'hSetNX' | 'hGet' | 'hDel' | 'hGetAll' | 'multi'
>;

export const importKeys = {
  pending: 'imports:{imports}:pending',
  processing: 'imports:{imports}:processing',
  suspects: 'imports:{imports}:suspects',
  reaperLock: 'imports:{imports}:reaper',
  lease: (jobId: string) => `imports:{imports}:lease:${jobId}`,
  token: (jobId: string) => `imports:{imports}:token:${jobId}`,
} as const;

/** Adds a job to the queue. */
export const enqueueImport = (jobId: string, client: RedisLike = redisClient) => client.lPush(importKeys.pending, jobId);

/** Takes the oldest pending id into `processing`; blocks up to `timeoutSec` (use a dedicated connection). */
export const takeNextImport = (client: RedisLike, timeoutSec: number) =>
  client.blMove(importKeys.pending, importKeys.processing, 'RIGHT', 'LEFT', timeoutSec);

export const leaseImport = (jobId: string, owner: string, ttlMs: number, client: RedisLike = redisClient) =>
  client.set(importKeys.lease(jobId), owner, { PX: ttlMs });

/** Extends the lease, only while it still exists (a reaped job does not come back to life). */
export const renewImportLease = async (jobId: string, ttlMs: number, client: RedisLike = redisClient) =>
  (await client.pExpire(importKeys.lease(jobId), ttlMs)) === 1;

/** The job is done (or being requeued): drop it from `processing` and release its lease. */
export async function finishImport(jobId: string, client: RedisLike = redisClient): Promise<void> {
  await client.multi().lRem(importKeys.processing, 1, jobId).del(importKeys.lease(jobId)).hDel(importKeys.suspects, jobId).exec();
}

/** Moves a job from `processing` back to the front of the line, in one transaction. */
export async function requeueImport(jobId: string, client: RedisLike = redisClient): Promise<void> {
  await client
    .multi()
    .lRem(importKeys.processing, 1, jobId)
    .del(importKeys.lease(jobId))
    .hDel(importKeys.suspects, jobId)
    .lPush(importKeys.pending, jobId)
    .exec();
}

export async function isQueued(jobId: string, client: RedisLike = redisClient): Promise<boolean> {
  const [pending, processing] = await Promise.all([
    client.lPos(importKeys.pending, jobId),
    client.lPos(importKeys.processing, jobId),
  ]);
  return pending !== null || processing !== null;
}

const TOKEN_TTL_SECONDS = 60 * 60;
const ENCRYPTED = 'enc:';

/**
 * A Drive access token waits in Redis for at most an hour, encrypted with
 * ENCRYPTION_KEY when one is configured (bound to the job id), and is deleted
 * as soon as the job finishes.
 */
export const storeDriveToken = (jobId: string, token: string, client: RedisLike = redisClient) =>
  client.set(importKeys.token(jobId), isEncryptionConfigured() ? `${ENCRYPTED}${encryptSecret(token, jobId)}` : token, {
    EX: TOKEN_TTL_SECONDS,
  });

export async function readDriveToken(jobId: string, client: RedisLike = redisClient): Promise<string | null> {
  const stored = await client.get(importKeys.token(jobId));
  if (!stored) return null;
  if (!stored.startsWith(ENCRYPTED)) return stored;
  try {
    return decryptSecret(stored.slice(ENCRYPTED.length), jobId);
  } catch {
    return null;
  }
}

export const dropDriveToken = (jobId: string, client: RedisLike = redisClient) => client.del(importKeys.token(jobId));
