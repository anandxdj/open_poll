import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { redisClient } from '../src/common/config/redis';
import { PLANS } from '../src/common/plans/plans';
import { openPollResponseGate, responseCountKey } from '../src/modules/billing/pollCap';
import { ResponseModel } from '../src/modules/responses/responses.model';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';

const WS_ID = new mongoose.Types.ObjectId();
const POLL_ID = new mongoose.Types.ObjectId();
const poll = (fields: Record<string, unknown> = {}) => ({
  _id: POLL_ID,
  workspaceId: WS_ID,
  expiresAt: new Date(Date.now() + 3_600_000),
  ...fields,
});

let stored: Record<string, unknown> | null;
let counts: Map<string, number>;
let expiries: Map<string, number>;
let storedResponses: number;
let workspaceReads: number;

const saved = {
  findById: WorkspaceModel.findById,
  countDocuments: ResponseModel.countDocuments,
  get: redisClient.get,
  incr: redisClient.incr,
  incrBy: redisClient.incrBy,
  decr: redisClient.decr,
  expire: redisClient.expire,
};

beforeEach(() => {
  stored = { plan: 'free', planOverrides: null, billing: {} };
  counts = new Map();
  expiries = new Map();
  storedResponses = 0;
  workspaceReads = 0;
  (WorkspaceModel as any).findById = () => ({
    select: () => ({
      lean: async () => {
        workspaceReads += 1;
        return stored;
      },
    }),
  });
  (ResponseModel as any).countDocuments = async () => storedResponses;
  (redisClient as any).get = async (key: string) => (counts.has(key) ? String(counts.get(key)) : null);
  (redisClient as any).incr = async (key: string) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts.get(key);
  };
  (redisClient as any).incrBy = async (key: string, amount: number) => {
    counts.set(key, (counts.get(key) ?? 0) + amount);
    return counts.get(key);
  };
  (redisClient as any).decr = async (key: string) => {
    counts.set(key, (counts.get(key) ?? 0) - 1);
    return counts.get(key);
  };
  (redisClient as any).expire = async (key: string, seconds: number) => {
    expiries.set(key, seconds);
    return true;
  };
});

afterEach(() => {
  (WorkspaceModel as any).findById = saved.findById;
  (ResponseModel as any).countDocuments = saved.countDocuments;
  Object.assign(redisClient as any, { get: saved.get, incr: saved.incr, incrBy: saved.incrBy, decr: saved.decr, expire: saved.expire });
});

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as any;
  }
  throw new Error('expected the poll to refuse the response');
};

const key = responseCountKey(String(POLL_ID));

describe('poll response cap (plan audienceCap)', () => {
  it('accepts responses up to the plan cap and refuses the next one', async () => {
    const cap = PLANS.free.limits.audienceCap!;
    const gate = await openPollResponseGate(poll() as any);
    for (let i = 0; i < cap; i += 1) await gate.reserve();
    expect(counts.get(key)).toBe(cap);

    const error = await refusal(gate.reserve());
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'audienceCap', max: cap, plan: 'free' },
    });
    // The refused attempt gave its slot back.
    expect(counts.get(key)).toBe(cap);
  });

  it('refuses early, before anything is reserved or spent, when the poll is already full', async () => {
    counts.set(key, PLANS.free.limits.audienceCap!);
    const error = await refusal(openPollResponseGate(poll() as any));
    expect(error).toMatchObject({ statusCode: 403, code: 'PLAN_LIMIT_REACHED' });
    expect(error.message).toBe('This poll has reached its maximum number of responses');
    expect(counts.get(key)).toBe(PLANS.free.limits.audienceCap!);
  });

  it('follows the workspace plan: upgrading lifts the cap at once', async () => {
    counts.set(key, 100);
    await refusal(openPollResponseGate(poll() as any));
    stored = { plan: 'pro', planOverrides: null, billing: {} };
    const gate = await openPollResponseGate(poll() as any);
    await gate.reserve();
    expect(counts.get(key)).toBe(101);
  });

  it('honours per-workspace overrides and unlimited plans', async () => {
    stored = { plan: 'free', planOverrides: { limits: { audienceCap: 2 } }, billing: {} };
    const gate = await openPollResponseGate(poll() as any);
    await gate.reserve();
    await gate.reserve();
    await refusal(gate.reserve());

    stored = { plan: 'free', planOverrides: { limits: { audienceCap: null } }, billing: {} };
    counts.clear();
    const unlimited = await openPollResponseGate(poll() as any);
    counts.set(key, 5_000_000);
    await unlimited.reserve();
    expect(counts.get(key)).toBe(5_000_000);
  });

  it('gives a slot back on request (a submission that failed after reserving)', async () => {
    const gate = await openPollResponseGate(poll() as any);
    const release = await gate.reserve();
    expect(counts.get(key)).toBe(1);
    await release();
    expect(counts.get(key)).toBe(0);
  });

  it('starts a new counter from the stored responses and expires it after the poll', async () => {
    storedResponses = 98;
    const gate = await openPollResponseGate(poll() as any);
    await gate.reserve();
    expect(counts.get(key)).toBe(99);
    await gate.reserve();
    await gate.reserve().then(
      () => {
        throw new Error('the 101st response must be refused');
      },
      (error) => expect(error.code).toBe('PLAN_LIMIT_REACHED'),
    );
    const ttl = expiries.get(key)!;
    expect(ttl).toBeGreaterThan(3_500 + 7 * 86_400 - 5);
    expect(ttl).toBeLessThanOrEqual(3_600 + 7 * 86_400);
  });

  it('does not cap polls from before workspaces, and reads no workspace for them', async () => {
    const gate = await openPollResponseGate(poll({ workspaceId: null }) as any);
    await gate.reserve();
    expect(workspaceReads).toBe(0);
    expect(counts.size).toBe(0);
  });

  it('treats a workspace that no longer exists as the Free plan', async () => {
    stored = null;
    counts.set(key, 100);
    expect(await refusal(openPollResponseGate(poll() as any))).toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });
});
