import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { redisClient } from '../src/common/config/redis';
import { errorHandler } from '../src/common/middlewares/errorHandler';
import { assertFeature, assertLimit, getEntitlements } from '../src/common/plans/entitlements';
import { PLANS } from '../src/common/plans/plans';
import { requireFeature } from '../src/common/plans/requireFeature';
import { consumeUsage, getUsage, usageKey, usagePeriod } from '../src/common/plans/usage';
import { UsageCounterModel } from '../src/modules/workspaces/usageCounter.model';
import { captureNext, mockReq, mockRes } from './helpers/http';

const WS_ID = '64b0000000000000000000a1';
const workspace = (fields: Record<string, unknown> = {}) => ({ _id: WS_ID, plan: 'free', planOverrides: null, ...fields });

const thrownBy = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as any;
  }
  throw new Error('expected a throw');
};

describe('plan defaults', () => {
  it('match the owner decisions', () => {
    expect(PLANS.free.limits.audienceCap).toBe(100);
    expect(PLANS.pro.limits.audienceCap).toBe(1_000);
    expect(PLANS.team.limits.audienceCap).toBe(2_000);
    for (const plan of Object.values(PLANS)) expect(plan.features.export_csv).toBe(true);
    for (const feature of ['export_xlsx', 'export_pdf', 'brand_kits', 'sso', 'scim', 'custom_domains', 'white_label'] as const) {
      expect(PLANS.free.features[feature]).toBe(false);
      expect(PLANS.enterprise.features[feature]).toBe(true);
    }
  });
});

describe('getEntitlements', () => {
  it('returns the plan defaults without overrides', () => {
    expect(getEntitlements(workspace({ plan: 'pro' }))).toEqual({
      plan: 'pro',
      features: PLANS.pro.features,
      limits: PLANS.pro.limits,
    });
  });

  it('merges planOverrides over the plan, key by key', () => {
    const result = getEntitlements(
      workspace({
        plan: 'team',
        planOverrides: { limits: { audienceCap: 5_000, aiDecksPerMonth: null }, features: { sso: true, brand_kits: false } },
      }),
    );
    expect(result.limits).toEqual({ ...PLANS.team.limits, audienceCap: 5_000, aiDecksPerMonth: null });
    expect(result.features).toEqual({ ...PLANS.team.features, sso: true, brand_kits: false });
    // The catalogue itself is never mutated.
    expect(PLANS.team.limits.audienceCap).toBe(2_000);
  });

  it('uses purchased seats unless an override pins them', () => {
    expect(getEntitlements(workspace({ plan: 'team', billing: { seats: 12 } })).limits.seats).toBe(12);
    expect(
      getEntitlements(workspace({ plan: 'team', billing: { seats: 12 }, planOverrides: { limits: { seats: 40 } } })).limits.seats,
    ).toBe(40);
  });

  it('falls back to free for an unknown plan and ignores invalid overrides', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(getEntitlements(workspace({ plan: 'platinum' })).plan).toBe('free');
      expect(getEntitlements(workspace({ planOverrides: { limits: { audienceCap: -5 } } })).limits.audienceCap).toBe(100);
      expect(getEntitlements(workspace({ planOverrides: { surprise: true } })).limits).toEqual(PLANS.free.limits);
    } finally {
      console.error = originalError;
    }
  });
});

describe('assertFeature / assertLimit', () => {
  it('rejects a feature outside the plan with FEATURE_NOT_IN_PLAN', () => {
    expect(thrownBy(() => assertFeature(workspace(), 'export_xlsx'))).toMatchObject({
      statusCode: 403,
      code: 'FEATURE_NOT_IN_PLAN',
      details: { feature: 'export_xlsx', plan: 'free' },
    });
    expect(() => assertFeature(workspace(), 'export_csv')).not.toThrow();
  });

  it('allows up to the limit and rejects beyond it', () => {
    expect(() => assertLimit(workspace(), 'audienceCap', 100)).not.toThrow();
    expect(thrownBy(() => assertLimit(workspace(), 'audienceCap', 101))).toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'audienceCap', max: 100 },
    });
  });

  it('treats a null limit as unlimited', () => {
    expect(() => assertLimit(workspace({ plan: 'enterprise' }), 'seats', 1_000_000)).not.toThrow();
  });
});

describe('requireFeature', () => {
  it('passes when the plan includes the feature', () => {
    const { next, calls } = captureNext();
    const req = Object.assign(mockReq(), { workspace: workspace({ plan: 'pro' }) });
    requireFeature('export_pdf')(req, mockRes() as any, next);
    expect(calls).toEqual([undefined]);
  });

  it('answers 403 FEATURE_NOT_IN_PLAN through the error handler', () => {
    const { next, calls } = captureNext();
    const req = Object.assign(mockReq(), { workspace: workspace() });
    requireFeature('export_pdf')(req, mockRes() as any, next);
    const res = mockRes();
    errorHandler(calls[0], req, res as any, () => {});
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      message: 'Your plan does not include this feature',
      code: 'FEATURE_NOT_IN_PLAN',
      details: { feature: 'export_pdf', plan: 'free' },
    });
  });

  it('fails loudly when mounted without workspace context', () => {
    const { next, calls } = captureNext();
    requireFeature('export_pdf')(mockReq(), mockRes() as any, next);
    expect(calls[0]).toMatchObject({ statusCode: 500 });
  });
});

describe('usage counters', () => {
  const redis = new Map<string, number>();
  const mirror = new Map<string, number>();
  let redisDown = false;
  const savedRedis = {
    incrBy: redisClient.incrBy,
    decrBy: redisClient.decrBy,
    expire: redisClient.expire,
    get: redisClient.get,
  };
  const savedModel = {
    findOne: UsageCounterModel.findOne,
    findOneAndUpdate: UsageCounterModel.findOneAndUpdate,
    updateOne: UsageCounterModel.updateOne,
  };
  const mirrorKey = (filter: any) => `${filter.workspaceId}:${filter.period}:${filter.counter}`;
  const lean = (value: unknown) => ({ lean: async () => value });
  const guard = () => {
    if (redisDown) throw new Error('ECONNREFUSED');
  };

  beforeEach(() => {
    redis.clear();
    mirror.clear();
    redisDown = false;
    (redisClient as any).incrBy = async (key: string, amount: number) => {
      guard();
      redis.set(key, (redis.get(key) ?? 0) + amount);
      return redis.get(key)!;
    };
    (redisClient as any).decrBy = async (key: string, amount: number) => {
      guard();
      redis.set(key, (redis.get(key) ?? 0) - amount);
      return redis.get(key)!;
    };
    (redisClient as any).expire = async () => {
      guard();
      return 1;
    };
    (redisClient as any).get = async (key: string) => {
      guard();
      return redis.has(key) ? String(redis.get(key)) : null;
    };
    (UsageCounterModel as any).findOne = (filter: any) =>
      lean(mirror.has(mirrorKey(filter)) ? { ...filter, value: mirror.get(mirrorKey(filter)) } : null);
    (UsageCounterModel as any).findOneAndUpdate = (filter: any, update: any) => {
      mirror.set(mirrorKey(filter), (mirror.get(mirrorKey(filter)) ?? 0) + update.$inc.value);
      return lean({ ...filter, value: mirror.get(mirrorKey(filter)) });
    };
    (UsageCounterModel as any).updateOne = async (filter: any, update: any) => {
      const key = mirrorKey(filter);
      if (update.$max) mirror.set(key, Math.max(mirror.get(key) ?? 0, update.$max.value));
      if (update.$inc) mirror.set(key, (mirror.get(key) ?? 0) + update.$inc.value);
      return { acknowledged: true };
    };
  });

  afterEach(() => {
    Object.assign(redisClient as any, savedRedis);
    Object.assign(UsageCounterModel as any, savedModel);
  });

  const free = workspace();
  const liveKey = () => usageKey(WS_ID, usagePeriod(), 'ai_deck');
  const mirrored = () => mirror.get(`${WS_ID}:${usagePeriod()}:ai_deck`);

  it('counts per month, mirrors to Mongo and refuses beyond the plan quota', async () => {
    const quota = PLANS.free.limits.aiDecksPerMonth!;
    for (let i = 1; i <= quota; i += 1) {
      expect(await consumeUsage(free, 'ai_deck')).toMatchObject({ used: i, limit: quota, remaining: quota - i });
    }
    expect(mirrored()).toBe(quota);

    await expect(consumeUsage(free, 'ai_deck')).rejects.toMatchObject({
      statusCode: 403,
      code: 'PLAN_LIMIT_REACHED',
      details: { limit: 'aiDecksPerMonth', max: quota, used: quota },
    });
    // The refused attempt consumed nothing.
    expect(redis.get(liveKey())).toBe(quota);
    expect((await getUsage(free, 'ai_deck')).used).toBe(quota);
  });

  it('never refuses an unlimited plan', async () => {
    const enterprise = workspace({ plan: 'enterprise' });
    for (let i = 0; i < 50; i += 1) await consumeUsage(enterprise, 'import');
    expect(await consumeUsage(enterprise, 'import', 5)).toMatchObject({ used: 55, limit: null, remaining: null });
  });

  it('resumes from the Mongo mirror when Redis lost the counter', async () => {
    mirror.set(`${WS_ID}:${usagePeriod()}:ai_deck`, 4);
    expect(await consumeUsage(free, 'ai_deck')).toMatchObject({ used: 5 });
    await expect(consumeUsage(free, 'ai_deck')).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });

  it('keeps counting and enforcing in Mongo while Redis is down', async () => {
    const originalError = console.error;
    console.error = () => {};
    redisDown = true;
    try {
      for (let i = 0; i < 5; i += 1) await consumeUsage(free, 'ai_deck');
      await expect(consumeUsage(free, 'ai_deck')).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
      expect(mirrored()).toBe(5);
      expect((await getUsage(free, 'ai_deck')).used).toBe(5);
    } finally {
      console.error = originalError;
    }
  });

  it('applies planOverrides to quotas', async () => {
    const boosted = workspace({ planOverrides: { limits: { aiDecksPerMonth: 1 } } });
    await consumeUsage(boosted, 'ai_deck');
    await expect(consumeUsage(boosted, 'ai_deck')).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
  });
});
