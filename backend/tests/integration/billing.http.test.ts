import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import mongoose from 'mongoose';
import type Stripe from 'stripe';
import { env } from '../../src/common/config/env';
import { registeredJobs } from '../../src/common/jobs/scheduler';
import { AuditEventModel } from '../../src/modules/audit/audit.model';
import { SEAT_SYNC_JOB, runSeatSync, syncWorkspaceSeats } from '../../src/modules/billing/seatSync';
import { StripeEventModel } from '../../src/modules/billing/stripeEvent.model';
import { clearPriceCache } from '../../src/modules/billing/plansCatalog';
import { setBillingRuntime } from '../../src/modules/billing/stripe';
import stripeEventsMigration from '../../src/migrations/120-stripe-events';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import {
  PRICES,
  billingRuntime,
  checkoutCompletedEvent,
  invoiceEvent,
  recurringPrice,
  signedDelivery,
  stripeDouble,
  subscriptionEvent,
  subscriptionFixture,
  type StripeDouble,
} from '../fixtures/stripe';
import { createPoll, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Billing against real Mongo and Redis through the real app: the public plan
 * catalogue, the billing API in disabled and enabled mode, the signed webhook
 * (replays, out-of-order events, retries), the seat sync job and the poll
 * response cap. Stripe itself is a double (tests/fixtures/stripe).
 */
describeIntegration('billing', () => {
  let server: TestServer;
  let owner: TestUser;
  let double: StripeDouble;
  let consoleError: ReturnType<typeof spyOn>;
  let consoleWarn: ReturnType<typeof spyOn>;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    owner = await createVerifiedUser({ name: 'Olivia' });
    double = stripeDouble();
    clearPriceCache();
    setBillingRuntime(null);
    consoleError = spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    setBillingRuntime(null);
  });

  afterAll(async () => {
    await server?.close();
  });

  const call = async (user: TestUser | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await server.request(path, { method, headers: { ...(user?.headers ?? {}), ...headers }, body });
    return { status: res.status, body: (await res.json()) as any };
  };

  const enableBilling = () => setBillingRuntime(billingRuntime(double));

  /** The owner's personal workspace (provisioned by the first request). */
  const personalWorkspace = async (user = owner) => {
    const list = await call(user, 'GET', '/api/workspaces');
    return list.body.data.workspaces[0]._id as string;
  };

  const deliver = async (event: Stripe.Event, overrides: { signature?: string; payload?: string } = {}) => {
    const signed = await signedDelivery(event);
    const res = await server.request('/api/billing/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': overrides.signature ?? signed.signature },
      body: overrides.payload ?? signed.payload,
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const stripeHas = (workspaceId: string, options = {}) => {
    const subscription = subscriptionFixture({ workspaceId, ...options });
    double.subscriptions.set(subscription.id, subscription);
    return subscription;
  };

  const workspaceDoc = (id: string) => WorkspaceModel.findById(id).lean();

  const flushAudits = () => new Promise((resolve) => setTimeout(resolve, 50));

  describe('plan catalogue', () => {
    it('GET /api/plans is public and lists the plan limits and features without any price when billing is off', async () => {
      const res = await call(null, 'GET', '/api/plans');
      expect(res.status).toBe(200);
      const { billingEnabled, plans } = res.body.data;
      expect(billingEnabled).toBe(false);
      expect(plans.map((plan: any) => plan.id)).toEqual(['free', 'pro', 'team', 'enterprise']);
      expect(plans[0]).toMatchObject({ id: 'free', name: 'Free', limits: { audienceCap: 100, seats: 1 }, features: { export_csv: true, export_pdf: false }, prices: null });
      expect(plans[2]).toMatchObject({ id: 'team', perSeat: true, checkout: { monthly: false, yearly: false } });
      expect(plans.every((plan: any) => plan.prices === null)).toBe(true);
    });

    it('lists prices only for the configured price ids', async () => {
      double.prices.set(PRICES.proMonthly, recurringPrice(PRICES.proMonthly, 'month', 1500));
      double.prices.set(PRICES.proYearly, recurringPrice(PRICES.proYearly, 'year', 14400));
      setBillingRuntime(
        billingRuntime(double, { config: { secretKey: 'sk_test_x', webhookSecret: 'whsec_x', prices: { proMonthly: PRICES.proMonthly, proYearly: PRICES.proYearly } } }),
      );
      const res = await call(null, 'GET', '/api/plans');
      expect(res.body.data.billingEnabled).toBe(true);
      const byId = Object.fromEntries(res.body.data.plans.map((plan: any) => [plan.id, plan]));
      expect(byId.pro.prices).toEqual({ monthly: { amount: 1500, currency: 'usd' }, yearly: { amount: 14400, currency: 'usd' } });
      expect(byId.team.prices).toEqual({ monthly: null, yearly: null });
      expect(byId.pro.checkout).toEqual({ monthly: true, yearly: true });
    });

    it('is cacheable and rate limited', async () => {
      expect((await server.request('/api/plans')).headers.get('cache-control')).toBe('public, max-age=60');
      let limited = 0;
      for (let i = 0; i < 125; i += 1) {
        if ((await server.request('/api/plans')).status === 429) limited += 1;
      }
      expect(limited).toBeGreaterThan(0);
    });

    it('reports the billing capability from the deployment configuration', async () => {
      const res = await call(null, 'GET', '/api/capabilities');
      expect(res.body.data.billing).toBe(env.billing !== null);
    });
  });

  describe('billing overview', () => {
    it('GET /api/billing needs a signed-in workspace owner', async () => {
      expect((await call(null, 'GET', '/api/billing')).status).toBe(401);
    });

    it('shows plan, usage against limits and disabled mode for a free workspace', async () => {
      const res = await call(owner, 'GET', '/api/billing');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        enabled: false,
        plan: 'free',
        planSource: 'default',
        status: null,
        canOpenPortal: false,
        workspace: { type: 'personal' },
        seats: { used: 1, limit: 1, purchased: null },
      });
      expect(res.body.data.usage).toHaveLength(2);
      expect(res.body.data.usage[0]).toMatchObject({ counter: 'ai_deck', used: 0, limit: 5, remaining: 5 });
      expect(res.body.data.checkout.pro).toEqual({ monthly: false, yearly: false });
    });

    it('is for the owner of the workspace, not its admins', async () => {
      const team = (await call(owner, 'POST', '/api/workspaces', { name: 'Acme' })).body.data;
      const admin = await createVerifiedUser({ name: 'Ada' });
      await WorkspaceMemberModel.create({ workspaceId: team.workspace._id, userId: admin.id, role: 'admin', status: 'active' });

      const asOwner = await call(owner, 'GET', '/api/billing', undefined, { 'X-Workspace-Id': team.workspace._id });
      expect(asOwner.status).toBe(200);
      expect(asOwner.body.data.workspace).toMatchObject({ _id: team.workspace._id, type: 'team' });

      const asAdmin = await call(admin, 'GET', '/api/billing', undefined, { 'X-Workspace-Id': team.workspace._id });
      expect(asAdmin.status).toBe(403);
      expect(asAdmin.body.code).toBe('FORBIDDEN');
      expect((await call(admin, 'POST', '/api/billing/portal', undefined, { 'X-Workspace-Id': team.workspace._id })).status).toBe(403);
    });

    it('never shows another workspace\'s billing', async () => {
      const other = await createVerifiedUser({ name: 'Mallory' });
      const res = await call(other, 'GET', '/api/billing', undefined, { 'X-Workspace-Id': await personalWorkspace() });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('WORKSPACE_FORBIDDEN');
    });
  });

  describe('without Stripe keys', () => {
    it('answers 503 BILLING_DISABLED for checkout, portal and the webhook, and fakes nothing', async () => {
      const checkout = await call(owner, 'POST', '/api/billing/checkout', { plan: 'pro', interval: 'monthly' });
      expect(checkout.status).toBe(503);
      expect(checkout.body).toMatchObject({ code: 'BILLING_DISABLED' });
      expect((await call(owner, 'POST', '/api/billing/portal')).status).toBe(503);
      const webhook = await deliver(subscriptionEvent('created'));
      expect(webhook.status).toBe(503);
      expect(webhook.body.code).toBe('BILLING_DISABLED');
      expect(await StripeEventModel.countDocuments()).toBe(0);
    });
  });

  describe('checkout and portal', () => {
    it('rejects an invalid checkout request', async () => {
      enableBilling();
      for (const body of [{}, { plan: 'free', interval: 'monthly' }, { plan: 'pro', interval: 'daily' }, { plan: 'pro', interval: 'monthly', workspaceId: 'x' }]) {
        expect((await call(owner, 'POST', '/api/billing/checkout', body)).status).toBe(400);
      }
      expect(double.calls.checkoutCreate).toHaveLength(0);
    });

    it('creates the customer and a Checkout session for the current workspace', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      const res = await call(owner, 'POST', '/api/billing/checkout', { plan: 'pro', interval: 'monthly' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ url: 'https://checkout.stripe.test/c/pay/cs_test_created' });

      const doc = await workspaceDoc(workspaceId);
      expect(doc?.billing?.stripeCustomerId).toBe('cus_created_1');
      expect(double.calls.checkoutCreate[0].params).toMatchObject({
        customer: 'cus_created_1',
        client_reference_id: workspaceId,
        line_items: [{ price: PRICES.proMonthly, quantity: 1 }],
      });

      // A second attempt reuses the stored customer.
      await call(owner, 'POST', '/api/billing/checkout', { plan: 'pro', interval: 'yearly' });
      expect(double.calls.customersCreate).toHaveLength(1);
      expect(double.calls.checkoutCreate[1].params.customer).toBe('cus_created_1');
    });

    it('sells Team seats for every active member', async () => {
      enableBilling();
      const team = (await call(owner, 'POST', '/api/workspaces', { name: 'Acme' })).body.data.workspace._id as string;
      for (const name of ['A', 'B']) {
        const member = await createVerifiedUser({ name });
        await WorkspaceMemberModel.create({ workspaceId: team, userId: member.id, role: 'editor', status: 'active' });
      }
      await call(owner, 'POST', '/api/billing/checkout', { plan: 'team', interval: 'yearly' }, { 'X-Workspace-Id': team });
      expect(double.calls.checkoutCreate[0].params.line_items[0]).toMatchObject({ price: PRICES.teamYearly, quantity: 3 });
      expect(double.calls.checkoutCreate[0].params.client_reference_id).toBe(team);
    });

    it('refuses a second subscription and a plan managed by hand', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'pro', planSource: 'stripe', billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' } } });
      const second = await call(owner, 'POST', '/api/billing/checkout', { plan: 'team', interval: 'monthly' });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ALREADY_SUBSCRIBED');

      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { planSource: 'manual', plan: 'enterprise', 'billing.status': 'canceled' } });
      const manual = await call(owner, 'POST', '/api/billing/checkout', { plan: 'pro', interval: 'monthly' });
      expect(manual.status).toBe(409);
      expect(manual.body.code).toBe('PLAN_MANAGED_MANUALLY');
      expect(double.calls.checkoutCreate).toHaveLength(0);
    });

    it('opens the billing portal once the workspace has a customer', async () => {
      enableBilling();
      const none = await call(owner, 'POST', '/api/billing/portal');
      expect(none.status).toBe(409);
      expect(none.body.code).toBe('NO_BILLING_ACCOUNT');

      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { 'billing.stripeCustomerId': 'cus_9' } });
      const res = await call(owner, 'POST', '/api/billing/portal');
      expect(res.status).toBe(200);
      expect(res.body.data.url).toBe('https://billing.stripe.test/p/session/bps_1');
      expect(double.calls.portalCreate[0].customer).toBe('cus_9');
    });

    it('audits checkout and portal use', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await call(owner, 'POST', '/api/billing/checkout', { plan: 'pro', interval: 'monthly' });
      await call(owner, 'POST', '/api/billing/portal');
      await flushAudits();
      const events = await AuditEventModel.find({ workspaceId }).sort({ createdAt: 1 }).lean();
      expect(events.map((event) => event.action)).toEqual(['billing.checkout.start', 'billing.portal.open']);
      expect(events[0]).toMatchObject({ actorType: 'user', meta: { plan: 'pro', interval: 'monthly', quantity: 1 } });
    });
  });

  describe('webhook', () => {
    it('rejects an unsigned, wrongly signed or tampered delivery with 400 and does nothing', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      stripeHas(workspaceId);
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { 'billing.stripeCustomerId': 'cus_1' } });
      const event = subscriptionEvent('created');
      const signed = await signedDelivery(event);

      const missing = await server.request('/api/billing/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: signed.payload });
      expect(missing.status).toBe(400);
      expect((await deliver(event, { signature: 'v1=nonsense' })).status).toBe(400);
      expect((await deliver(event, { payload: signed.payload.replace('sub_1', 'sub_2') })).status).toBe(400);
      expect((await deliver(event, { signature: (await signedDelivery(event, 'whsec_other')).signature })).status).toBe(400);
      expect(await StripeEventModel.countDocuments()).toBe(0);
      expect((await workspaceDoc(workspaceId))?.plan).toBe('free');
    });

    it('upgrades the workspace from a checkout and its subscription events, and each event runs once', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      stripeHas(workspaceId, { price: PRICES.proYearly });

      const completed = checkoutCompletedEvent({ workspaceId, eventId: 'evt_checkout' });
      const first = await deliver(completed);
      expect(first).toMatchObject({ status: 200, body: { data: { received: true, outcome: 'processed' } } });
      let doc = await workspaceDoc(workspaceId);
      expect(doc).toMatchObject({
        plan: 'pro',
        planSource: 'stripe',
        billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', priceId: PRICES.proYearly },
      });

      const replay = await deliver(completed);
      expect(replay).toMatchObject({ status: 200, body: { data: { outcome: 'duplicate' } } });
      expect(double.calls.retrieve).toEqual(['sub_1']);

      expect((await deliver(subscriptionEvent('created', { eventId: 'evt_sub_created' }))).body.data.outcome).toBe('processed');
      expect((await deliver(invoiceEvent('paid', { eventId: 'evt_paid' }))).body.data.outcome).toBe('processed');
      doc = await workspaceDoc(workspaceId);
      expect(doc?.plan).toBe('pro');

      const records = await StripeEventModel.find().sort({ _id: 1 }).lean();
      expect(records.map((record) => [record._id, record.status])).toEqual([
        ['evt_checkout', 'processed'],
        ['evt_paid', 'processed'],
        ['evt_sub_created', 'processed'],
      ]);
      expect(records[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);

      // The new plan is what the workspace API reports.
      const detail = await call(owner, 'GET', `/api/workspaces/${workspaceId}`);
      expect(detail.body.data.entitlements.plan).toBe('pro');
      expect(detail.body.data.entitlements.features.export_pdf).toBe(true);
      const overview = await call(owner, 'GET', '/api/billing');
      expect(overview.body.data).toMatchObject({ plan: 'pro', status: 'active', subscription: { plan: 'pro', interval: 'yearly' } });
    });

    it('acknowledges event types it does not handle', async () => {
      enableBilling();
      const res = await deliver({ id: 'evt_x', object: 'event', type: 'customer.created', created: 1, livemode: false, data: { object: {} } } as unknown as Stripe.Event);
      expect(res).toMatchObject({ status: 200, body: { data: { outcome: 'ignored' } } });
      expect(await StripeEventModel.countDocuments()).toBe(0);
    });

    it('handles concurrent deliveries of one event exactly once', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      stripeHas(workspaceId);
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { 'billing.stripeCustomerId': 'cus_1' } });
      const event = subscriptionEvent('created', { eventId: 'evt_race' });
      const results = await Promise.all(Array.from({ length: 6 }, () => deliver(event)));
      const outcomes = results.map((result) => result.body.data?.outcome ?? result.status);
      expect(outcomes.filter((outcome) => outcome === 'processed')).toHaveLength(1);
      expect(outcomes.every((outcome) => ['processed', 'duplicate', 409].includes(outcome))).toBe(true);
      expect(await StripeEventModel.countDocuments({ _id: 'evt_race' })).toBe(1);
      // Everything that was not processed was told to retry or that it is done.
      expect((await deliver(event)).body.data.outcome).toBe('duplicate');
    });

    it('applies the latest subscription state when events arrive out of order', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { 'billing.stripeCustomerId': 'cus_1' } });
      // Stripe's state: upgraded, then cancelled. The events are delivered newest first.
      stripeHas(workspaceId, { status: 'canceled' });
      expect((await deliver(subscriptionEvent('deleted', { status: 'canceled', created: 300, eventId: 'evt_3' }))).status).toBe(200);
      expect((await deliver(subscriptionEvent('updated', { status: 'active', created: 200, eventId: 'evt_2' }))).status).toBe(200);
      expect((await deliver(subscriptionEvent('created', { status: 'active', created: 100, eventId: 'evt_1' }))).status).toBe(200);
      expect(await workspaceDoc(workspaceId)).toMatchObject({ plan: 'free', planSource: 'default', billing: { status: 'canceled', stripeSubscriptionId: 'sub_1' } });

      // Then the customer subscribes again: a new subscription takes over, and a late event of the old one cannot downgrade it.
      stripeHas(workspaceId, { id: 'sub_2', price: PRICES.teamMonthly, quantity: 3 });
      await deliver(subscriptionEvent('created', { id: 'sub_2', price: PRICES.teamMonthly, quantity: 3, eventId: 'evt_4' }));
      expect(await workspaceDoc(workspaceId)).toMatchObject({ plan: 'team', planSource: 'stripe', billing: { stripeSubscriptionId: 'sub_2', seats: 3 } });
      double.subscriptions.set('sub_1', subscriptionFixture({ workspaceId, status: 'canceled' }));
      await deliver(subscriptionEvent('deleted', { status: 'canceled', eventId: 'evt_5' }));
      expect(await workspaceDoc(workspaceId)).toMatchObject({ plan: 'team', billing: { stripeSubscriptionId: 'sub_2', seats: 3, status: 'active' } });
    });

    it('downgrades on deletion and clears purchased seats', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'team', planSource: 'stripe', billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', seats: 6 } } });
      stripeHas(workspaceId, { status: 'canceled', price: PRICES.teamMonthly, quantity: 6 });
      await deliver(subscriptionEvent('deleted', { status: 'canceled', price: PRICES.teamMonthly }));
      const doc = await workspaceDoc(workspaceId);
      expect(doc).toMatchObject({ plan: 'free', planSource: 'default', billing: { status: 'canceled', seats: null } });
      await flushAudits();
      const change = await AuditEventModel.findOne({ workspaceId, action: 'billing.plan.change' }).lean();
      expect(change).toMatchObject({ actorType: 'system', meta: { from: 'team', to: 'free', status: 'canceled' } });
    });

    it('keeps the plan while a payment is retried and audits the failure', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'pro', planSource: 'stripe', billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' } } });
      stripeHas(workspaceId, { status: 'past_due' });
      await deliver(invoiceEvent('payment_failed'));
      expect(await workspaceDoc(workspaceId)).toMatchObject({ plan: 'pro', billing: { status: 'past_due' } });
      const overview = await call(owner, 'GET', '/api/billing');
      expect(overview.body.data).toMatchObject({ plan: 'pro', status: 'past_due', paymentFailed: true });
      await flushAudits();
      expect(await AuditEventModel.countDocuments({ workspaceId, action: 'billing.payment.failed' })).toBe(1);
    });

    it('never overwrites a plan set by hand', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { plan: 'enterprise', planSource: 'manual', 'billing.stripeCustomerId': 'cus_1' } });
      stripeHas(workspaceId, { status: 'canceled' });
      await deliver(subscriptionEvent('deleted', { status: 'canceled' }));
      expect(await workspaceDoc(workspaceId)).toMatchObject({ plan: 'enterprise', planSource: 'manual', billing: { status: 'canceled' } });
    });

    it('fails a delivery whose handler failed, and the retry completes it', async () => {
      enableBilling();
      const workspaceId = await personalWorkspace();
      await WorkspaceModel.updateOne({ _id: workspaceId }, { $set: { 'billing.stripeCustomerId': 'cus_1' } });
      stripeHas(workspaceId);
      const event = subscriptionEvent('created', { eventId: 'evt_retry' });

      double.fail.retrieve = new Error('stripe is down');
      const failed = await deliver(event);
      expect(failed.status).toBe(500);
      expect(await StripeEventModel.findById('evt_retry').lean()).toMatchObject({ status: 'failed', error: 'stripe is down', attempts: 1 });
      expect((await workspaceDoc(workspaceId))?.plan).toBe('free');

      delete double.fail.retrieve;
      const retried = await deliver(event);
      expect(retried).toMatchObject({ status: 200, body: { data: { outcome: 'processed' } } });
      expect(await StripeEventModel.findById('evt_retry').lean()).toMatchObject({ status: 'processed', attempts: 2, error: null });
      expect((await workspaceDoc(workspaceId))?.plan).toBe('pro');
    });

    it('tells Stripe to retry while another delivery is still working on the event', async () => {
      enableBilling();
      await StripeEventModel.create({ _id: 'evt_busy', type: 'invoice.paid', status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 86_400_000) });
      const res = await deliver(invoiceEvent('paid', { eventId: 'evt_busy' }));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WEBHOOK_IN_PROGRESS');
    });

    it('creates the StripeEvent TTL index (migration 120)', async () => {
      await stripeEventsMigration.up({ db: mongoose.connection.db!, connection: mongoose.connection, log: () => {} } as any);
      const indexes = await StripeEventModel.collection.indexes();
      expect(indexes.find((index) => index.key.expiresAt === 1)).toMatchObject({ expireAfterSeconds: 0 });
    });
  });

  describe('seat sync', () => {
    const teamWorkspace = async (members: number, seats: number | null, overrides: Record<string, unknown> = {}) => {
      const team = await WorkspaceModel.create({
        name: 'Acme',
        slug: `acme-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
        type: 'team',
        ownerId: owner.id,
        plan: 'team',
        planSource: 'stripe',
        billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', priceId: PRICES.teamMonthly, seats },
        ...overrides,
      });
      await WorkspaceMemberModel.create({ workspaceId: team._id, userId: owner.id, role: 'owner', status: 'active' });
      for (let i = 1; i < members; i += 1) {
        const member = await createVerifiedUser({ name: `M${i}` });
        await WorkspaceMemberModel.create({ workspaceId: team._id, userId: member.id, role: 'editor', status: 'active' });
      }
      return team;
    };

    it('registers the seat sync job', () => {
      const job = registeredJobs().find((candidate) => candidate.name === SEAT_SYNC_JOB);
      expect(job).toBeDefined();
      expect(job!.everyMs).toBeGreaterThanOrEqual(60_000);
    });

    it('raises the subscription to the active members, and records the new seat count', async () => {
      const team = await teamWorkspace(4, 2);
      stripeHas(String(team._id), { price: PRICES.teamMonthly, quantity: 2 });
      const runtime = billingRuntime(double);

      const totals = await runSeatSync(runtime);
      expect(totals).toEqual({ checked: 1, raised: 1, failed: 0 });
      expect(double.calls.subscriptionsUpdate).toEqual([
        { id: 'sub_1', params: { items: [{ id: 'si_1', quantity: 4 }], proration_behavior: 'create_prorations' } },
      ]);
      expect((await workspaceDoc(String(team._id)))?.billing?.seats).toBe(4);
      await flushAudits();
      expect(await AuditEventModel.findOne({ workspaceId: team._id, action: 'billing.seats.raise' }).lean()).toMatchObject({
        meta: { from: 2, to: 4, subscriptionId: 'sub_1' },
      });

      // Nothing more to do on the next pass.
      expect(await runSeatSync(runtime)).toEqual({ checked: 1, raised: 0, failed: 0 });
      expect(double.calls.subscriptionsUpdate).toHaveLength(1);
    });

    it('never lowers purchased seats, and leaves other workspaces alone', async () => {
      const roomy = await teamWorkspace(2, 10);
      const manual = await teamWorkspace(3, null, { planSource: 'manual', billing: { stripeSubscriptionId: 'sub_9', status: 'active' } });
      const free = await WorkspaceModel.create({ name: 'Solo', slug: 'solo-abc123', type: 'team', ownerId: owner.id, plan: 'free' });
      stripeHas(String(roomy._id), { price: PRICES.teamMonthly, quantity: 10 });
      const totals = await runSeatSync(billingRuntime(double));
      expect(totals).toEqual({ checked: 1, raised: 0, failed: 0 });
      expect(double.calls.subscriptionsUpdate).toHaveLength(0);
      expect((await workspaceDoc(String(roomy._id)))?.billing?.seats).toBe(10);
      expect((await workspaceDoc(String(manual._id)))?.billing?.seats).toBeNull();
      expect(free).toBeDefined();
    });

    it('skips what it must not touch, and keeps going when one workspace fails', async () => {
      const bad = await teamWorkspace(3, 1, { billing: { stripeCustomerId: 'cus_bad', stripeSubscriptionId: 'sub_bad', status: 'active', seats: 1 } });
      const good = await teamWorkspace(3, 1, { billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', seats: 1 } });
      double.subscriptions.set('sub_bad', subscriptionFixture({ id: 'sub_bad', customer: 'cus_bad', price: PRICES.teamMonthly, quantity: 1 }));
      stripeHas(String(good._id), { price: PRICES.teamMonthly, quantity: 1 });
      const original = (double.client.subscriptions as any).update;
      (double.client.subscriptions as any).update = async (id: string, params: unknown, options: unknown) => {
        if (id === 'sub_bad') throw new Error('card required');
        return original(id, params, options);
      };
      const totals = await runSeatSync(billingRuntime(double));
      expect(totals).toEqual({ checked: 2, raised: 1, failed: 1 });
      expect((await workspaceDoc(String(good._id)))?.billing?.seats).toBe(3);
      expect((await workspaceDoc(String(bad._id)))?.billing?.seats).toBe(1);
    });

    it('does not touch a subscription that ended', async () => {
      const team = await teamWorkspace(3, 1, { billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'canceled', seats: 1 } });
      expect(await syncWorkspaceSeats(billingRuntime(double), team)).toEqual({ outcome: 'skipped', reason: 'not_entitled' });
      expect(double.calls.retrieve).toHaveLength(0);
    });
  });

  describe('poll response cap', () => {
    const ballotFor = async (pollId: string) => {
      const ballot = await call(null, 'POST', `/api/responses/poll/${pollId}/ballot`);
      expect(ballot.status).toBe(200);
      return ballot.body.data.ballotToken as string;
    };
    const submit = (pollId: string, questionId: string, ballotToken: string) =>
      call(null, 'POST', '/api/responses', { pollId, ballotToken, answers: [{ questionId, selectedOptionIndex: 0 }] });
    const vote = async (pollId: string, questionId: string) => submit(pollId, questionId, await ballotFor(pollId));

    it('stops a poll at its plan response cap, and a plan upgrade lifts it', async () => {
      await personalWorkspace();
      const poll = await createPoll(server, owner);
      const questionId = poll.questions[0]._id;
      await WorkspaceModel.updateOne({ _id: poll.workspaceId }, { $set: { planOverrides: { limits: { audienceCap: 2 } } } });

      expect((await vote(poll._id, questionId)).status).toBe(201);
      expect((await vote(poll._id, questionId)).status).toBe(201);
      const ballotToken = await ballotFor(poll._id);
      const refused = await submit(poll._id, questionId, ballotToken);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { limit: 'audienceCap', max: 2, plan: 'free' } });

      // The refused voter's ballot was not spent: after an upgrade the very same vote goes through.
      await WorkspaceModel.updateOne({ _id: poll.workspaceId }, { $set: { plan: 'pro', planOverrides: null } });
      expect((await submit(poll._id, questionId, ballotToken)).status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await mongoose.connection.collection('responses').countDocuments({ pollId: new mongoose.Types.ObjectId(poll._id) })).toBe(3);
    });

    it('rebuilds the count from stored responses when Redis lost it', async () => {
      await personalWorkspace();
      const poll = await createPoll(server, owner);
      const questionId = poll.questions[0]._id;
      await WorkspaceModel.updateOne({ _id: poll.workspaceId }, { $set: { planOverrides: { limits: { audienceCap: 2 } } } });
      await vote(poll._id, questionId);
      await vote(poll._id, questionId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const { redisClient } = await import('../../src/common/config/redis');
      await redisClient.del(`poll:${poll._id}:responseCount`);
      // The first submission after the loss resumes from the two stored responses and is refused.
      expect((await vote(poll._id, questionId)).status).toBe(403);
    });
  });
});
