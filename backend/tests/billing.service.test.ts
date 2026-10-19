import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import mongoose from 'mongoose';
import { redisClient } from '../src/common/config/redis';
import { env } from '../src/common/config/env';
import { PLANS } from '../src/common/plans/plans';
import { UserModel } from '../src/modules/auth/auth.model';
import {
  createCheckoutSession,
  createPortalSession,
  getBillingOverview,
  type BillingActor,
} from '../src/modules/billing/billing.service';
import { clearPriceCache, getPlanCatalog } from '../src/modules/billing/plansCatalog';
import { setBillingRuntime } from '../src/modules/billing/stripe';
import { UsageCounterModel } from '../src/modules/workspaces/usageCounter.model';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../src/modules/workspaces/workspaceMember.model';
import { PRICES, billingRuntime, recurringPrice, stripeDouble, type StripeDouble } from './fixtures/stripe';

const id = () => new mongoose.Types.ObjectId();
const USER_ID = String(id());

let double: StripeDouble;
let members: number;
let consoleError: ReturnType<typeof spyOn>;
let customerWrites: Array<{ filter: any; update: any }>;
let storedCustomer: string | null;

const saved = {
  count: WorkspaceMemberModel.countDocuments,
  updateOne: WorkspaceModel.updateOne,
  findById: WorkspaceModel.findById,
  userFindById: UserModel.findById,
  usageFindOne: UsageCounterModel.findOne,
  redisGet: redisClient.get,
};

const workspace = (fields: Record<string, unknown> = {}): any => ({
  _id: id(),
  name: 'Acme',
  slug: 'acme-abc123',
  type: 'team',
  ownerId: USER_ID,
  plan: 'free',
  planSource: 'default',
  planOverrides: null,
  billing: {},
  ...fields,
});

const actor = (role = 'owner', fields: Record<string, unknown> = {}): BillingActor => {
  const ws = workspace(fields);
  return {
    user: { id: USER_ID },
    workspace: ws,
    membership: { workspaceId: ws._id, userId: USER_ID, role, status: 'active' } as any,
  };
};

beforeEach(() => {
  double = stripeDouble();
  members = 1;
  customerWrites = [];
  storedCustomer = null;
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
  (WorkspaceMemberModel as any).countDocuments = async () => members;
  (WorkspaceModel as any).updateOne = async (filter: any, update: any) => {
    customerWrites.push({ filter, update });
    return { matchedCount: storedCustomer ? 0 : 1 };
  };
  (WorkspaceModel as any).findById = () => ({
    select: () => ({ lean: async () => ({ billing: { stripeCustomerId: storedCustomer } }) }),
  });
  (UserModel as any).findById = () => ({ select: async () => ({ email: 'owner@example.com', name: 'Owner' }) });
  (UsageCounterModel as any).findOne = () => ({ lean: async () => null });
  (redisClient as any).get = async () => null;
  setBillingRuntime(billingRuntime(double));
});

afterEach(() => {
  consoleError.mockRestore();
  (WorkspaceMemberModel as any).countDocuments = saved.count;
  (WorkspaceModel as any).updateOne = saved.updateOne;
  (WorkspaceModel as any).findById = saved.findById;
  (UserModel as any).findById = saved.userFindById;
  (UsageCounterModel as any).findOne = saved.usageFindOne;
  (redisClient as any).get = saved.redisGet;
  setBillingRuntime(null);
  clearPriceCache();
});

const thrown = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as any;
  }
  throw new Error('expected a rejection');
};

describe('getBillingOverview', () => {
  it('reports a free workspace with usage against the plan limits', async () => {
    (redisClient as any).get = async (key: string) => (key.endsWith(':ai_deck') ? '3' : null);
    const overview = await getBillingOverview(actor());
    expect(overview).toMatchObject({
      enabled: true,
      plan: 'free',
      planSource: 'default',
      status: null,
      subscription: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      paymentFailed: false,
      canOpenPortal: false,
      checkoutBlockedReason: null,
      seats: { used: 1, limit: 1, purchased: null },
    });
    expect(overview.usage).toEqual([
      expect.objectContaining({ counter: 'ai_deck', limitKey: 'aiDecksPerMonth', used: 3, limit: PLANS.free.limits.aiDecksPerMonth, remaining: 2 }),
      expect.objectContaining({ counter: 'import', limitKey: 'importsPerMonth', used: 0, limit: PLANS.free.limits.importsPerMonth }),
    ]);
    expect(overview.checkout).toEqual({
      pro: { monthly: true, yearly: true },
      team: { monthly: true, yearly: true },
    });
    expect(overview.entitlements.plan).toBe('free');
  });

  it('reports disabled mode: no checkout, no portal', async () => {
    setBillingRuntime(null);
    const overview = await getBillingOverview(actor('owner', { billing: { stripeCustomerId: 'cus_1' } }));
    expect(overview.enabled).toBe(false);
    expect(overview.canOpenPortal).toBe(false);
    expect(overview.checkout.pro).toEqual({ monthly: false, yearly: false });
  });

  it('describes an active Team subscription', async () => {
    members = 3;
    const end = new Date('2026-11-19T00:00:00Z');
    const overview = await getBillingOverview(
      actor('owner', {
        plan: 'team',
        planSource: 'stripe',
        billing: {
          stripeCustomerId: 'cus_1',
          stripeSubscriptionId: 'sub_1',
          status: 'active',
          priceId: PRICES.teamYearly,
          seats: 8,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: true,
        },
      }),
    );
    expect(overview).toMatchObject({
      plan: 'team',
      planSource: 'stripe',
      status: 'active',
      subscription: { plan: 'team', interval: 'yearly' },
      currentPeriodEnd: end,
      cancelAtPeriodEnd: true,
      canOpenPortal: true,
      seats: { used: 3, limit: 8, purchased: 8 },
      checkoutBlockedReason: 'already_subscribed',
    });
    expect(overview.checkout.team).toEqual({ monthly: false, yearly: false });
  });

  it('flags a failed payment while the paid plan is still in force', async () => {
    const overview = await getBillingOverview(
      actor('owner', { plan: 'pro', planSource: 'stripe', billing: { stripeSubscriptionId: 'sub_1', status: 'past_due', priceId: PRICES.proMonthly } }),
    );
    expect(overview).toMatchObject({ plan: 'pro', paymentFailed: true, status: 'past_due' });
  });

  it('says so when a workspace is on a plan assigned by hand', async () => {
    const overview = await getBillingOverview(actor('owner', { plan: 'enterprise', planSource: 'manual' }));
    expect(overview).toMatchObject({ plan: 'enterprise', planSource: 'manual', checkoutBlockedReason: 'plan_managed_manually' });
    expect(overview.checkout.pro.monthly).toBe(false);
  });

  it('shows the ended subscription of a downgraded workspace and offers checkout again', async () => {
    const overview = await getBillingOverview(
      actor('owner', { billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'canceled', priceId: PRICES.proMonthly } }),
    );
    expect(overview).toMatchObject({ plan: 'free', status: 'canceled', checkoutBlockedReason: null, canOpenPortal: true });
    expect(overview.checkout.pro.monthly).toBe(true);
  });

  it('is for the owner only', async () => {
    for (const role of ['admin', 'editor', 'presenter', 'viewer']) {
      expect(await thrown(getBillingOverview(actor(role)))).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    }
  });
});

describe('createCheckoutSession', () => {
  it('answers 503 BILLING_DISABLED without Stripe keys, and never calls Stripe', async () => {
    setBillingRuntime(null);
    expect(await thrown(createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly' }))).toMatchObject({
      statusCode: 503,
      code: 'BILLING_DISABLED',
    });
    expect(double.calls.checkoutCreate).toHaveLength(0);
  });

  it('answers 503 BILLING_DISABLED for a plan whose price is not configured', async () => {
    setBillingRuntime(billingRuntime(double, { config: { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', prices: { proMonthly: PRICES.proMonthly } } }));
    const error = await thrown(createCheckoutSession(actor(), { plan: 'team', interval: 'yearly' }));
    expect(error).toMatchObject({ statusCode: 503, code: 'BILLING_DISABLED', details: { reason: 'price_not_configured', plan: 'team', interval: 'yearly' } });
    await createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly' });
    expect(double.calls.checkoutCreate).toHaveLength(1);
  });

  it('only the owner may buy', async () => {
    expect(await thrown(createCheckoutSession(actor('admin'), { plan: 'pro', interval: 'monthly' }))).toMatchObject({ statusCode: 403 });
    expect(double.calls.customersCreate).toHaveLength(0);
  });

  it('creates the workspace customer once and a subscription checkout session for Pro', async () => {
    const owner = actor();
    const result = await createCheckoutSession(owner, { plan: 'pro', interval: 'yearly' });
    expect(result).toEqual({ url: 'https://checkout.stripe.test/c/pay/cs_test_created', sessionId: 'cs_test_created', quantity: 1 });

    const workspaceId = String(owner.workspace._id);
    expect(double.calls.customersCreate).toHaveLength(1);
    expect(double.calls.customersCreate[0].params).toMatchObject({
      name: 'Acme',
      email: 'owner@example.com',
      metadata: { workspaceId },
    });
    expect(double.calls.customersCreate[0].options.idempotencyKey).toBe(`openpoll-customer-${workspaceId}`);
    expect(customerWrites[0]).toEqual({
      filter: { _id: owner.workspace._id, 'billing.stripeCustomerId': null },
      update: { $set: { 'billing.stripeCustomerId': 'cus_created_1' } },
    });

    const { params } = double.calls.checkoutCreate[0];
    expect(params).toMatchObject({
      mode: 'subscription',
      customer: 'cus_created_1',
      client_reference_id: workspaceId,
      line_items: [{ price: PRICES.proYearly, quantity: 1 }],
      subscription_data: { metadata: { workspaceId, plan: 'pro' } },
      metadata: { workspaceId, plan: 'pro', interval: 'yearly' },
      success_url: `${env.FRONTEND_URL}/settings/billing?checkout=success`,
      cancel_url: `${env.FRONTEND_URL}/settings/billing?checkout=canceled`,
    });
    expect(params.line_items[0].adjustable_quantity).toBeUndefined();
    expect(params.automatic_tax).toBeUndefined();
  });

  it('reuses the existing customer', async () => {
    await createCheckoutSession(actor('owner', { billing: { stripeCustomerId: 'cus_existing' } }), { plan: 'pro', interval: 'monthly' });
    expect(double.calls.customersCreate).toHaveLength(0);
    expect(double.calls.checkoutCreate[0].params.customer).toBe('cus_existing');
  });

  it('adopts the customer a concurrent checkout stored first', async () => {
    storedCustomer = 'cus_winner';
    await createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly' });
    expect(double.calls.checkoutCreate[0].params.customer).toBe('cus_winner');
  });

  it('sells Team per seat: at least one per active member, and the buyer may add more', async () => {
    members = 4;
    await createCheckoutSession(actor(), { plan: 'team', interval: 'monthly' });
    expect(double.calls.checkoutCreate[0].params.line_items[0]).toEqual({
      price: PRICES.teamMonthly,
      quantity: 4,
      adjustable_quantity: { enabled: true, minimum: 4, maximum: 1000 },
    });
    await createCheckoutSession(actor(), { plan: 'team', interval: 'monthly', seats: 10 });
    expect(double.calls.checkoutCreate[1].params.line_items[0].quantity).toBe(10);
    await createCheckoutSession(actor(), { plan: 'team', interval: 'monthly', seats: 2 });
    expect(double.calls.checkoutCreate[2].params.line_items[0].quantity).toBe(4);
  });

  it('ignores seats for Pro', async () => {
    await createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly', seats: 9 });
    expect(double.calls.checkoutCreate[0].params.line_items[0]).toEqual({ price: PRICES.proMonthly, quantity: 1 });
  });

  it('collects tax details when automatic tax is on', async () => {
    setBillingRuntime(billingRuntime(double, { automaticTax: true }));
    await createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly' });
    expect(double.calls.checkoutCreate[0].params).toMatchObject({
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
    });
  });

  it('refuses to sell a second subscription, and a plan managed by hand', async () => {
    const subscribed = actor('owner', { plan: 'pro', planSource: 'stripe', billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' } });
    expect(await thrown(createCheckoutSession(subscribed, { plan: 'team', interval: 'monthly' }))).toMatchObject({ statusCode: 409, code: 'ALREADY_SUBSCRIBED' });
    const manual = actor('owner', { plan: 'enterprise', planSource: 'manual' });
    expect(await thrown(createCheckoutSession(manual, { plan: 'pro', interval: 'monthly' }))).toMatchObject({ statusCode: 409, code: 'PLAN_MANAGED_MANUALLY' });
    expect(double.calls.checkoutCreate).toHaveLength(0);
  });

  it('sells again after a subscription ended', async () => {
    const ended = actor('owner', { billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'canceled' } });
    await createCheckoutSession(ended, { plan: 'pro', interval: 'monthly' });
    expect(double.calls.checkoutCreate).toHaveLength(1);
  });

  it('turns a Stripe failure into 502 without leaking its message', async () => {
    double.fail.checkout = new Error('No such price: price_secret_internal');
    const error = await thrown(createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly' }));
    expect(error).toMatchObject({ statusCode: 502, code: 'BILLING_PROVIDER_ERROR' });
    expect(error.message).not.toContain('price_secret_internal');
    double.fail.checkout = undefined;
    double.fail.customers = new Error('rate limited');
    expect(await thrown(createCheckoutSession(actor(), { plan: 'pro', interval: 'monthly' }))).toMatchObject({ statusCode: 502 });
  });
});

describe('createPortalSession', () => {
  it('answers 503 BILLING_DISABLED without Stripe keys', async () => {
    setBillingRuntime(null);
    expect(await thrown(createPortalSession(actor('owner', { billing: { stripeCustomerId: 'cus_1' } })))).toMatchObject({
      statusCode: 503,
      code: 'BILLING_DISABLED',
    });
  });

  it('needs a billing account first', async () => {
    expect(await thrown(createPortalSession(actor()))).toMatchObject({ statusCode: 409, code: 'NO_BILLING_ACCOUNT' });
    expect(double.calls.portalCreate).toHaveLength(0);
  });

  it('opens the portal for the workspace customer and returns to the billing page', async () => {
    const result = await createPortalSession(actor('owner', { billing: { stripeCustomerId: 'cus_1' } }));
    expect(result.url).toBe('https://billing.stripe.test/p/session/bps_1');
    expect(double.calls.portalCreate).toEqual([{ customer: 'cus_1', return_url: `${env.FRONTEND_URL}/settings/billing` }]);
  });

  it('is for the owner only, and a Stripe failure is a 502', async () => {
    expect(await thrown(createPortalSession(actor('admin', { billing: { stripeCustomerId: 'cus_1' } })))).toMatchObject({ statusCode: 403 });
    double.fail.portal = new Error('boom');
    expect(await thrown(createPortalSession(actor('owner', { billing: { stripeCustomerId: 'cus_1' } })))).toMatchObject({ statusCode: 502 });
  });
});

describe('getPlanCatalog', () => {
  it('lists every plan with its limits and features, and no prices without billing', async () => {
    const catalog = await getPlanCatalog(null);
    expect(catalog.billingEnabled).toBe(false);
    expect(catalog.plans.map((plan) => plan.id)).toEqual(['free', 'pro', 'team', 'enterprise']);
    for (const plan of catalog.plans) {
      expect(plan.limits).toEqual(PLANS[plan.id].limits);
      expect(plan.features).toEqual(PLANS[plan.id].features);
      expect(plan.prices).toBeNull();
      expect(plan.checkout).toEqual({ monthly: false, yearly: false });
    }
    expect(catalog.plans.find((plan) => plan.id === 'team')?.perSeat).toBe(true);
    expect(catalog.plans.find((plan) => plan.id === 'pro')?.perSeat).toBe(false);
  });

  it('shows prices read from Stripe for the configured price ids only', async () => {
    double.prices.set(PRICES.proMonthly, recurringPrice(PRICES.proMonthly, 'month', 1500));
    double.prices.set(PRICES.proYearly, recurringPrice(PRICES.proYearly, 'year', 14400, 'EUR'));
    const runtime = billingRuntime(double, { config: { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', prices: { proMonthly: PRICES.proMonthly, proYearly: PRICES.proYearly } } });
    const catalog = await getPlanCatalog(runtime);
    const byId = Object.fromEntries(catalog.plans.map((plan) => [plan.id, plan]));
    expect(catalog.billingEnabled).toBe(true);
    expect(byId.pro!.prices).toEqual({ monthly: { amount: 1500, currency: 'usd' }, yearly: { amount: 14400, currency: 'eur' } });
    expect(byId.pro!.checkout).toEqual({ monthly: true, yearly: true });
    expect(byId.team!.prices).toEqual({ monthly: null, yearly: null });
    expect(byId.team!.checkout).toEqual({ monthly: false, yearly: false });
    expect(byId.free!.prices).toBeNull();
    expect(byId.enterprise!.prices).toBeNull();
  });

  it('shows no price rather than a wrong one: wrong interval, inactive, tiered or unreadable', async () => {
    double.prices.set(PRICES.proMonthly, recurringPrice(PRICES.proMonthly, 'year', 1500));
    double.prices.set(PRICES.proYearly, { ...recurringPrice(PRICES.proYearly, 'year', 14400), active: false });
    double.prices.set(PRICES.teamMonthly, { ...recurringPrice(PRICES.teamMonthly, 'month', 0), billing_scheme: 'tiered', unit_amount: null });
    const catalog = await getPlanCatalog(billingRuntime(double));
    const byId = Object.fromEntries(catalog.plans.map((plan) => [plan.id, plan]));
    expect(byId.pro!.prices).toEqual({ monthly: null, yearly: null });
    expect(byId.team!.prices).toEqual({ monthly: null, yearly: null });
  });

  it('caches prices and does not call Stripe on every request', async () => {
    let reads = 0;
    double.prices.set(PRICES.proMonthly, recurringPrice(PRICES.proMonthly, 'month', 1500));
    const original = (double.client.prices as any).retrieve;
    (double.client.prices as any).retrieve = async (priceId: string) => {
      reads += 1;
      return original(priceId);
    };
    const runtime = billingRuntime(double);
    await getPlanCatalog(runtime);
    const first = reads;
    await Promise.all([getPlanCatalog(runtime), getPlanCatalog(runtime)]);
    expect(first).toBe(4);
    expect(reads).toBe(first);
  });
});
