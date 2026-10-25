import type { Types } from 'mongoose';
import { redisClient } from '../config/redis';
import { ApiError } from '../utils/ApiError';
import { UsageCounterModel } from '../../modules/workspaces/usageCounter.model';
import { getEntitlements, type EntitlementSubject } from './entitlements';
import { USAGE_COUNTERS, type UsageCounterName } from './plans';

/**
 * Monthly usage counters (AI decks, imports). Redis holds the live count;
 * every successful consumption is mirrored to the UsageCounter collection so a
 * counter Redis lost is restored, and counting falls back to Mongo while Redis
 * is unavailable. Limits hold with or without billing.
 */

type UsageSubject = EntitlementSubject & { _id: Types.ObjectId | string };

export interface UsageResult {
  counter: UsageCounterName;
  period: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  remaining: number | null;
}

/** Outlives the longest month, so a key never expires inside its own period. */
const KEY_TTL_SECONDS = 40 * 24 * 60 * 60;

/** UTC calendar month as yyyymm. */
export const usagePeriod = (date = new Date()) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** Hash-tagged by workspace so a workspace's counters share a cluster slot. */
export const usageKey = (workspaceId: string, period: string, counter: UsageCounterName) =>
  `usage:{${workspaceId}}:${period}:${counter}`;

const mirrorFilter = (workspaceId: string, period: string, counter: UsageCounterName) => ({
  workspaceId,
  period,
  counter,
});

async function incrementInRedis(key: string, amount: number, filter: ReturnType<typeof mirrorFilter>) {
  let used = await redisClient.incrBy(key, amount);
  if (used === amount) {
    // First increment of this key: set its TTL, and resume from the Mongo mirror
    // in case Redis lost the counter (restart without persistence, eviction).
    await redisClient.expire(key, KEY_TTL_SECONDS);
    const mirrored = await UsageCounterModel.findOne(filter).lean();
    if (mirrored && mirrored.value > 0) used = await redisClient.incrBy(key, mirrored.value);
  }
  return used;
}

/**
 * Adds `amount` to the workspace's counter for the current month. Throws 403
 * PLAN_LIMIT_REACHED (and consumes nothing) when that would exceed the plan.
 */
export async function consumeUsage(ws: UsageSubject, counter: UsageCounterName, amount = 1): Promise<UsageResult> {
  if (!Number.isInteger(amount) || amount < 1) throw new Error(`consumeUsage amount must be a positive integer, got ${amount}`);
  const workspaceId = String(ws._id);
  const period = usagePeriod();
  const limit = getEntitlements(ws).limits[USAGE_COUNTERS[counter]];
  const key = usageKey(workspaceId, period, counter);
  const filter = mirrorFilter(workspaceId, period, counter);

  let used: number;
  let viaRedis = true;
  try {
    used = await incrementInRedis(key, amount, filter);
  } catch (error) {
    console.error('[Usage] Redis unavailable, counting in Mongo:', (error as Error)?.message);
    viaRedis = false;
    const doc = await UsageCounterModel.findOneAndUpdate(
      filter,
      { $inc: { value: amount } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    ).lean();
    used = doc?.value ?? amount;
  }

  if (limit !== null && used > limit) {
    try {
      if (viaRedis) await redisClient.decrBy(key, amount);
      else await UsageCounterModel.updateOne(filter, { $inc: { value: -amount } });
    } catch (error) {
      console.error('[Usage] Failed to roll back a refused increment:', (error as Error)?.message);
    }
    throw new ApiError(403, 'Your plan limit has been reached', 'PLAN_LIMIT_REACHED', {
      limit: USAGE_COUNTERS[counter],
      max: limit,
      used: used - amount,
      period,
    });
  }

  if (viaRedis) {
    // $max keeps the mirror monotonic when concurrent writes land out of order.
    await UsageCounterModel.updateOne(filter, { $max: { value: used } }, { upsert: true }).catch((error) =>
      console.error('[Usage] Failed to mirror usage counter:', (error as Error)?.message),
    );
  }

  return { counter, period, used, limit, remaining: limit === null ? null : limit - used };
}

/** Current month's count without consuming anything. */
export async function getUsage(ws: UsageSubject, counter: UsageCounterName): Promise<UsageResult> {
  const workspaceId = String(ws._id);
  const period = usagePeriod();
  const limit = getEntitlements(ws).limits[USAGE_COUNTERS[counter]];
  let used: number | null = null;
  try {
    const value = await redisClient.get(usageKey(workspaceId, period, counter));
    if (value !== null) used = Number(value);
  } catch (error) {
    console.error('[Usage] Redis unavailable, reading the Mongo mirror:', (error as Error)?.message);
  }
  if (used === null) {
    const mirrored = await UsageCounterModel.findOne(mirrorFilter(workspaceId, period, counter)).lean();
    used = mirrored?.value ?? 0;
  }
  return { counter, period, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}
