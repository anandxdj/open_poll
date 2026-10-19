import type { Types } from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { assertLimit, getEntitlements, type EntitlementSubject } from '../../common/plans/entitlements';
import { ApiError } from '../../common/utils/ApiError';
import { ResponseModel } from '../responses/responses.model';
import { WorkspaceModel } from '../workspaces/workspace.model';

/**
 * Response cap of a poll: the plan's `audienceCap` (the same number that caps
 * a live session) is the most responses one poll accepts. It holds with or
 * without Stripe billing; upgrading the workspace lifts it immediately.
 *
 * The count lives in Redis (`poll:<id>:responseCount`, INCR, expiring a week
 * after the poll does) and is rebuilt from the stored responses when the key
 * is missing. A poll without a workspace predates workspaces (migration 020)
 * and is not capped. Trial attempts count like votes: the cap is on
 * submissions.
 */

export interface PollForCap {
  _id: unknown;
  workspaceId?: Types.ObjectId | null;
  expiresAt: Date;
}

export interface ResponseGate {
  /**
   * Atomically takes one response slot, or throws 403 PLAN_LIMIT_REACHED when
   * the poll is full. The returned function gives the slot back (call it when
   * the submission fails after this point).
   */
  reserve(): Promise<() => Promise<void>>;
}

const GRACE_SEC = 7 * 86_400;
const noRelease = async () => {};
const OPEN_GATE: ResponseGate = { reserve: async () => noRelease };

export const responseCountKey = (pollId: string) => `poll:${pollId}:responseCount`;

const fullError = (error: unknown) =>
  error instanceof ApiError
    ? new ApiError(403, 'This poll has reached its maximum number of responses', error.code, error.details)
    : error;

/**
 * Loads the poll's plan once and refuses early (before the caller spends a
 * ballot or an identity marker, which would lock a voter out after the owner
 * upgrades) when the poll is already full. Use the gate's `reserve()` for the
 * authoritative, atomic take.
 */
export async function openPollResponseGate(poll: PollForCap): Promise<ResponseGate> {
  if (!poll.workspaceId) return OPEN_GATE;

  const workspace = await WorkspaceModel.findById(poll.workspaceId).select('plan planOverrides billing').lean();
  // A workspace that no longer exists falls back to the strictest plan.
  const subject: EntitlementSubject = workspace ?? { plan: 'free' };
  const limit = getEntitlements(subject).limits.audienceCap;
  if (limit === null) return OPEN_GATE;

  const pollId = String(poll._id);
  const key = responseCountKey(pollId);
  const recorded = await redisClient.get(key);
  if (recorded !== null) {
    try {
      assertLimit(subject, 'audienceCap', Number(recorded) + 1);
    } catch (error) {
      throw fullError(error);
    }
  }

  return {
    async reserve() {
      let used = await redisClient.incr(key);
      if (used === 1) {
        await redisClient.expire(key, Math.ceil(Math.max(0, poll.expiresAt.getTime() - Date.now()) / 1000) + GRACE_SEC);
        // First submission since the key was created (or lost): resume from what is stored.
        const stored = await ResponseModel.countDocuments({ pollId: poll._id as Types.ObjectId });
        if (stored > 0) used = await redisClient.incrBy(key, stored);
      }
      try {
        assertLimit(subject, 'audienceCap', used);
      } catch (error) {
        await redisClient.decr(key).catch(() => undefined);
        throw fullError(error);
      }
      return async () => {
        await redisClient.decr(key).catch(() => undefined);
      };
    },
  };
}
