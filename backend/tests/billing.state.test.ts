import { describe, expect, it } from 'bun:test';
import { MAX_SEATS, checkoutSchema } from '../src/modules/billing/billing.schema';
import { checkoutAvailability, planForPrice, priceIdFor } from '../src/modules/billing/prices';
import {
  decideSubscriptionUpdate,
  isEntitledStatus,
  snapshotFromSubscription,
  type SubscriptionDecision,
} from '../src/modules/billing/subscriptionState';
import { PRICES, inDays, subscriptionFixture } from './fixtures/stripe';

const snapshot = (options = {}) => snapshotFromSubscription(subscriptionFixture(options), PRICES);

type Applied = Extract<SubscriptionDecision, { apply: true }>;
const applied = (decision: SubscriptionDecision): Applied => {
  expect(decision.apply).toBe(true);
  return decision as Applied;
};

describe('price ↔ plan mapping', () => {
  it('maps each configured price id to its plan and interval', () => {
    expect(planForPrice(PRICES, PRICES.proMonthly)).toEqual({ plan: 'pro', interval: 'monthly' });
    expect(planForPrice(PRICES, PRICES.proYearly)).toEqual({ plan: 'pro', interval: 'yearly' });
    expect(planForPrice(PRICES, PRICES.teamMonthly)).toEqual({ plan: 'team', interval: 'monthly' });
    expect(planForPrice(PRICES, PRICES.teamYearly)).toEqual({ plan: 'team', interval: 'yearly' });
  });

  it('knows nothing about other, missing or empty prices', () => {
    expect(planForPrice(PRICES, 'price_other')).toBeNull();
    expect(planForPrice(PRICES, null)).toBeNull();
    expect(planForPrice(PRICES, undefined)).toBeNull();
    expect(planForPrice(PRICES, '')).toBeNull();
    expect(planForPrice({}, PRICES.proMonthly)).toBeNull();
  });

  it('resolves the price to charge and reports what checkout can sell', () => {
    expect(priceIdFor(PRICES, 'team', 'yearly')).toBe(PRICES.teamYearly);
    expect(priceIdFor({ proMonthly: 'price_a' }, 'pro', 'yearly')).toBeNull();
    expect(checkoutAvailability({ proMonthly: 'price_a', teamYearly: 'price_b' })).toEqual({
      pro: { monthly: true, yearly: false },
      team: { monthly: false, yearly: true },
    });
    expect(checkoutAvailability(null)).toEqual({
      pro: { monthly: false, yearly: false },
      team: { monthly: false, yearly: false },
    });
  });
});

describe('checkout input', () => {
  it('accepts a paid plan, an interval and optional seats', () => {
    expect(checkoutSchema.parse({ plan: 'pro', interval: 'monthly' })).toEqual({ plan: 'pro', interval: 'monthly' });
    expect(checkoutSchema.parse({ plan: 'team', interval: 'yearly', seats: 8 }).seats).toBe(8);
  });

  it('rejects free and enterprise, bad intervals, seat counts out of range and unknown keys', () => {
    for (const body of [
      { plan: 'free', interval: 'monthly' },
      { plan: 'enterprise', interval: 'monthly' },
      { plan: 'pro', interval: 'weekly' },
      { plan: 'team', interval: 'monthly', seats: 0 },
      { plan: 'team', interval: 'monthly', seats: MAX_SEATS + 1 },
      { plan: 'team', interval: 'monthly', seats: 1.5 },
      { plan: 'pro', interval: 'monthly', workspaceId: '64b0000000000000000000a1' },
      { plan: 'pro', interval: 'monthly', price: 'price_free' },
      {},
    ]) {
      expect(checkoutSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('snapshotFromSubscription', () => {
  it('reads the plan item, quantity, period end and workspace metadata', () => {
    const result = snapshot({ price: PRICES.teamYearly, quantity: 6, periodEnd: inDays(10), workspaceId: '64b0000000000000000000a1' });
    expect(result).toMatchObject({
      id: 'sub_1',
      customerId: 'cus_1',
      status: 'active',
      priceId: PRICES.teamYearly,
      itemId: 'si_1',
      quantity: 6,
      cancelAtPeriodEnd: false,
      workspaceId: '64b0000000000000000000a1',
    });
    expect(result.currentPeriodEnd?.getTime()).toBe(inDays(10) * 1000);
  });

  it('reads the period end from the subscription on older API versions', () => {
    expect(snapshot({ legacyPeriodEnd: true, periodEnd: inDays(5) }).currentPeriodEnd?.getTime()).toBe(inDays(5) * 1000);
  });

  it('picks the item whose price maps to a plan, not just the first', () => {
    const result = snapshot({ extraItems: [{ id: 'si_addon', price: { id: 'price_addon' }, quantity: 3 }] });
    expect(result.priceId).toBe(PRICES.proMonthly);
    expect(result.itemId).toBe('si_1');
  });

  it('expands an expanded customer object and flags a scheduled cancellation', () => {
    const subscription = subscriptionFixture({ cancelAtPeriodEnd: true });
    (subscription as any).customer = { id: 'cus_obj' };
    const result = snapshotFromSubscription(subscription, PRICES);
    expect(result.customerId).toBe('cus_obj');
    expect(result.cancelAtPeriodEnd).toBe(true);
  });

  it('ignores a workspace id that is not a string', () => {
    const subscription = subscriptionFixture();
    (subscription as any).metadata = { workspaceId: 42 };
    expect(snapshotFromSubscription(subscription, PRICES).workspaceId).toBeNull();
  });
});

describe('isEntitledStatus', () => {
  it('keeps the paid plan while Stripe still collects payment', () => {
    for (const status of ['active', 'trialing', 'past_due']) expect(isEntitledStatus(status)).toBe(true);
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '', null, undefined]) {
      expect(isEntitledStatus(status)).toBe(false);
    }
  });
});

describe('decideSubscriptionUpdate', () => {
  const free = { plan: 'free', planSource: 'default', billing: {} };

  it('upgrades a free workspace to the plan of an active subscription', () => {
    const decision = applied(decideSubscriptionUpdate(free, snapshot(), PRICES));
    expect(decision).toMatchObject({ plan: 'pro', previousPlan: 'free', managedManually: false, unknownPrice: false });
    expect(decision.set).toMatchObject({
      plan: 'pro',
      planSource: 'stripe',
      'billing.stripeSubscriptionId': 'sub_1',
      'billing.status': 'active',
      'billing.priceId': PRICES.proMonthly,
      'billing.stripeCustomerId': 'cus_1',
      'billing.seats': null,
    });
  });

  it('records the quantity as seats on the per-seat Team plan only', () => {
    const team = applied(decideSubscriptionUpdate(free, snapshot({ price: PRICES.teamMonthly, quantity: 7 }), PRICES));
    expect(team.set).toMatchObject({ plan: 'team', 'billing.seats': 7 });
    const zero = applied(decideSubscriptionUpdate(free, snapshot({ price: PRICES.teamMonthly, quantity: 0 }), PRICES));
    expect(zero.set['billing.seats']).toBe(1);
  });

  it('keeps the paid plan while a payment is being retried (past_due) and during a trial', () => {
    for (const status of ['past_due', 'trialing']) {
      const decision = applied(decideSubscriptionUpdate(free, snapshot({ status }), PRICES));
      expect(decision.plan).toBe('pro');
      expect(decision.set.planSource).toBe('stripe');
    }
  });

  const pro = {
    plan: 'pro',
    planSource: 'stripe',
    billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', seats: null },
  };

  it('downgrades to Free when the subscription ends, and clears purchased seats', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      const decision = applied(decideSubscriptionUpdate(pro, snapshot({ status }), PRICES));
      expect(decision).toMatchObject({ plan: 'free', previousPlan: 'pro' });
      expect(decision.set).toMatchObject({ plan: 'free', planSource: 'default', 'billing.seats': null, 'billing.status': status });
    }
    const team = { ...pro, plan: 'team', billing: { ...pro.billing, seats: 5 } };
    expect(applied(decideSubscriptionUpdate(team, snapshot({ status: 'canceled', price: PRICES.teamMonthly }), PRICES)).set['billing.seats']).toBeNull();
  });

  it('moves between plans when the price changes', () => {
    const decision = applied(decideSubscriptionUpdate(pro, snapshot({ price: PRICES.teamYearly, quantity: 3 }), PRICES));
    expect(decision).toMatchObject({ plan: 'team', previousPlan: 'pro' });
    expect(decision.set['billing.seats']).toBe(3);
  });

  it('never overwrites a plan set by hand; it only records the billing fields', () => {
    const manual = { plan: 'enterprise', planSource: 'manual', billing: {} };
    const decision = applied(decideSubscriptionUpdate(manual, snapshot(), PRICES));
    expect(decision).toMatchObject({ plan: 'enterprise', previousPlan: 'enterprise', managedManually: true });
    expect('plan' in decision.set).toBe(false);
    expect('planSource' in decision.set).toBe(false);
    expect('billing.seats' in decision.set).toBe(false);
    expect(decision.set['billing.status']).toBe('active');

    const ended = applied(decideSubscriptionUpdate(manual, snapshot({ status: 'canceled' }), PRICES));
    expect(ended.plan).toBe('enterprise');
    expect('plan' in ended.set).toBe(false);
  });

  it('leaves the plan alone for an entitled subscription on a price it does not know', () => {
    const decision = applied(decideSubscriptionUpdate(pro, snapshot({ price: 'price_unknown' }), PRICES));
    expect(decision).toMatchObject({ plan: 'pro', unknownPrice: true });
    expect('plan' in decision.set).toBe(false);
    // ...but an ended unknown-price subscription still downgrades.
    expect(applied(decideSubscriptionUpdate(pro, snapshot({ price: 'price_unknown', status: 'canceled' }), PRICES)).plan).toBe('free');
  });

  it('ignores late events of an old subscription once the workspace follows another', () => {
    const following = { ...pro, billing: { ...pro.billing, stripeSubscriptionId: 'sub_new' } };
    expect(decideSubscriptionUpdate(following, snapshot({ id: 'sub_old', status: 'canceled' }), PRICES)).toEqual({
      apply: false,
      reason: 'stale_subscription',
    });
    expect(decideSubscriptionUpdate(following, snapshot({ id: 'sub_old', status: 'incomplete_expired' }), PRICES).apply).toBe(false);
  });

  it('lets a new entitled subscription take over after the old one ended', () => {
    const ended = { plan: 'free', planSource: 'default', billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old', status: 'canceled' } };
    const decision = applied(decideSubscriptionUpdate(ended, snapshot({ id: 'sub_new' }), PRICES));
    expect(decision).toMatchObject({ plan: 'pro', replacedSubscriptionId: null });
    expect(decision.set['billing.stripeSubscriptionId']).toBe('sub_new');
  });

  it('flags a takeover from a subscription that is still billing', () => {
    const decision = applied(decideSubscriptionUpdate(pro, snapshot({ id: 'sub_second', price: PRICES.proYearly }), PRICES));
    expect(decision.replacedSubscriptionId).toBe('sub_1');
  });

  it('keeps the first Stripe customer of a workspace', () => {
    const decision = applied(decideSubscriptionUpdate(pro, snapshot({ customer: 'cus_other' }), PRICES));
    expect('billing.stripeCustomerId' in decision.set).toBe(false);
  });

  it('is a plain update when the same subscription repeats (idempotent)', () => {
    const first = applied(decideSubscriptionUpdate(free, snapshot(), PRICES));
    const again = applied(
      decideSubscriptionUpdate({ plan: 'pro', planSource: 'stripe', billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' } }, snapshot(), PRICES),
    );
    expect(again.plan).toBe(first.plan);
    expect(again.previousPlan).toBe('pro');
    expect(again.replacedSubscriptionId).toBeNull();
  });
});
