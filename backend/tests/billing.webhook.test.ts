import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import mongoose from 'mongoose';
import { redisClient } from '../src/common/config/redis';
import { AuditEventModel } from '../src/modules/audit/audit.model';
import { StripeEventModel } from '../src/modules/billing/stripeEvent.model';
import { setBillingRuntime } from '../src/modules/billing/stripe';
import {
  EVENT_HANDLERS,
  HANDLED_EVENT_TYPES,
  invoiceSubscriptionId,
  processStripeEvent,
  verifyStripeEvent,
} from '../src/modules/billing/webhook.service';
import { WorkspaceModel } from '../src/modules/workspaces/workspace.model';
import {
  PRICES,
  WEBHOOK_SECRET,
  billingRuntime,
  checkoutCompletedEvent,
  eventFixture,
  invoiceEvent,
  signedDelivery,
  stripeDouble,
  subscriptionEvent,
  subscriptionFixture,
  type StripeDouble,
} from './fixtures/stripe';

/**
 * Webhook behaviour with Mongo and Redis stubbed in memory: signature check,
 * exactly-once claiming and the six handlers against fixture events. The same
 * flows run against real services in tests/integration/billing.http.test.ts.
 */

const WS_ID = new mongoose.Types.ObjectId().toString();

type Doc = Record<string, any>;
let events: Map<string, Doc>;
let workspaces: Map<string, Doc>;
let audits: Doc[];
let double: StripeDouble;
let consoleError: ReturnType<typeof spyOn>;
let consoleWarn: ReturnType<typeof spyOn>;

const asQuery = <T>(value: T) => ({ lean: async () => value, select: () => asQuery(value), then: (ok: any, bad: any) => Promise.resolve(value).then(ok, bad) });

const saved = {
  eventCreate: StripeEventModel.create,
  eventFindOneAndUpdate: StripeEventModel.findOneAndUpdate,
  eventFindById: StripeEventModel.findById,
  eventUpdateOne: StripeEventModel.updateOne,
  wsFindOne: WorkspaceModel.findOne,
  wsFindById: WorkspaceModel.findById,
  wsUpdateOne: WorkspaceModel.updateOne,
  auditCreate: AuditEventModel.create,
  set: redisClient.set,
  eval: redisClient.eval,
};

const getPath = (doc: Doc, path: string) => path.split('.').reduce<any>((value, key) => value?.[key], doc);
const setPath = (doc: Doc, path: string, value: unknown) => {
  const keys = path.split('.');
  let target = doc;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)!] = value;
};

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Doc[]).some((branch) => matches(doc, branch));
    const value = key === '_id' ? doc._id : getPath(doc, key);
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('$ne' in condition) return value !== condition.$ne;
      if ('$lt' in condition) return value < condition.$lt;
    }
    return (value ?? null) === (condition ?? null);
  });
}

beforeEach(() => {
  events = new Map();
  workspaces = new Map([
    [
      WS_ID,
      { _id: WS_ID, name: 'Acme', plan: 'free', planSource: 'default', planOverrides: null, billing: { stripeCustomerId: 'cus_1' } },
    ],
  ]);
  audits = [];
  double = stripeDouble();
  consoleError = spyOn(console, 'error').mockImplementation(() => {});
  consoleWarn = spyOn(console, 'warn').mockImplementation(() => {});

  (StripeEventModel as any).create = async (doc: Doc) => {
    if (events.has(doc._id)) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    events.set(doc._id, { ...doc });
    return doc;
  };
  (StripeEventModel as any).findOneAndUpdate = (filter: Doc, update: Doc) => {
    const doc = events.get(filter._id);
    if (!doc || !matches(doc, filter)) return asQuery(null);
    Object.assign(doc, update.$set);
    doc.attempts += update.$inc?.attempts ?? 0;
    return asQuery(doc);
  };
  (StripeEventModel as any).findById = (id: string) => asQuery(events.get(id) ?? null);
  (StripeEventModel as any).updateOne = async (filter: Doc, update: Doc) => {
    const doc = events.get(filter._id);
    if (doc) Object.assign(doc, update.$set);
    return { matchedCount: doc ? 1 : 0 };
  };
  // Reads return copies, like Mongoose documents: a later update does not change what was read.
  const copy = (doc: Doc | undefined) => (doc ? structuredClone(doc) : null);
  (WorkspaceModel as any).findOne = (filter: Doc) =>
    Promise.resolve(copy([...workspaces.values()].find((doc) => matches(doc, filter))));
  (WorkspaceModel as any).findById = (id: string) => Promise.resolve(copy(workspaces.get(String(id))));
  (WorkspaceModel as any).updateOne = async (filter: Doc, update: Doc) => {
    const doc = workspaces.get(String(filter._id));
    if (!doc || !matches(doc, { ...filter, _id: doc._id })) return { matchedCount: 0, modifiedCount: 0 };
    for (const [path, value] of Object.entries(update.$set ?? {})) setPath(doc, path, value);
    return { matchedCount: 1, modifiedCount: 1 };
  };
  (AuditEventModel as any).create = async (doc: Doc) => {
    audits.push(doc);
    return doc;
  };
  (redisClient as any).set = async () => 'OK';
  (redisClient as any).eval = async () => 1;
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  Object.assign(StripeEventModel as any, {
    create: saved.eventCreate,
    findOneAndUpdate: saved.eventFindOneAndUpdate,
    findById: saved.eventFindById,
    updateOne: saved.eventUpdateOne,
  });
  Object.assign(WorkspaceModel as any, { findOne: saved.wsFindOne, findById: saved.wsFindById, updateOne: saved.wsUpdateOne });
  (AuditEventModel as any).create = saved.auditCreate;
  (redisClient as any).set = saved.set;
  (redisClient as any).eval = saved.eval;
  setBillingRuntime(null);
});

const flushAudits = () => new Promise((resolve) => setTimeout(resolve, 0));
const workspace = () => workspaces.get(WS_ID)!;

describe('verifyStripeEvent', () => {
  it('returns the event for a payload signed with the webhook secret', async () => {
    const event = subscriptionEvent('created', { eventId: 'evt_sig' });
    const { payload, signature } = await signedDelivery(event);
    const verified = await verifyStripeEvent(billingRuntime(double), Buffer.from(payload), signature);
    expect(verified.id).toBe('evt_sig');
  });

  const rejects = async (body: unknown, signature: unknown, code: string) => {
    await expect(verifyStripeEvent(billingRuntime(double), body, signature)).rejects.toMatchObject({ statusCode: 400, code });
  };

  it('answers 400 for a missing, wrong or stale signature and a tampered payload', async () => {
    const { payload, signature } = await signedDelivery(subscriptionEvent('created'));
    await rejects(Buffer.from(payload), undefined, 'WEBHOOK_SIGNATURE_INVALID');
    await rejects(Buffer.from(payload), 'garbage', 'WEBHOOK_SIGNATURE_INVALID');
    await rejects(Buffer.from(payload.replace('sub_1', 'sub_9')), signature, 'WEBHOOK_SIGNATURE_INVALID');
    const other = await signedDelivery(subscriptionEvent('created'), 'whsec_someone_else');
    await rejects(Buffer.from(other.payload), other.signature, 'WEBHOOK_SIGNATURE_INVALID');
  });

  it('answers 400 when the body is not the raw payload', async () => {
    const { signature } = await signedDelivery(subscriptionEvent('created'));
    await rejects({ id: 'evt_parsed' }, signature, 'WEBHOOK_PAYLOAD_INVALID');
    await rejects(Buffer.alloc(0), signature, 'WEBHOOK_PAYLOAD_INVALID');
    await rejects(undefined, signature, 'WEBHOOK_PAYLOAD_INVALID');
  });

  it('uses the secret the runtime holds', async () => {
    const event = subscriptionEvent('created');
    const { payload, signature } = await signedDelivery(event, 'whsec_rotated');
    await rejects(Buffer.from(payload), signature, 'WEBHOOK_SIGNATURE_INVALID');
    const runtime = billingRuntime(double);
    runtime.config.webhookSecret = 'whsec_rotated';
    expect((await verifyStripeEvent(runtime, Buffer.from(payload), signature)).id).toBe(event.id);
    expect(WEBHOOK_SECRET).not.toBe('whsec_rotated');
  });
});

describe('processStripeEvent', () => {
  const event = () => eventFixture('invoice.paid', {}, { id: 'evt_once' });

  it('runs the handler once and acknowledges replays without running it again', async () => {
    let runs = 0;
    const handlers = { 'invoice.paid': async () => void (runs += 1) };
    const runtime = billingRuntime(double);
    expect(await processStripeEvent(runtime, event(), handlers)).toBe('processed');
    expect(await processStripeEvent(runtime, event(), handlers)).toBe('duplicate');
    expect(await processStripeEvent(runtime, event(), handlers)).toBe('duplicate');
    expect(runs).toBe(1);
    expect(events.get('evt_once')).toMatchObject({ status: 'processed', attempts: 1, type: 'invoice.paid' });
    expect(events.get('evt_once')!.processedAt).toBeInstanceOf(Date);
  });

  it('only one of two concurrent deliveries runs the handler', async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const handlers = {
      'invoice.paid': async () => {
        runs += 1;
        await gate;
      },
    };
    const runtime = billingRuntime(double);
    const first = processStripeEvent(runtime, event(), handlers);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second delivery arrives while the first is still working: Stripe is told to retry later.
    expect(await processStripeEvent(runtime, event(), handlers)).toBe('in_progress');
    release();
    expect(await first).toBe('processed');
    expect(runs).toBe(1);
  });

  it('marks a failed handler and lets the retry take the event over', async () => {
    let attempt = 0;
    const handlers = {
      'invoice.paid': async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('database unavailable');
      },
    };
    const runtime = billingRuntime(double);
    await expect(processStripeEvent(runtime, event(), handlers)).rejects.toThrow('database unavailable');
    expect(events.get('evt_once')).toMatchObject({ status: 'failed', error: 'database unavailable', attempts: 1 });
    expect(await processStripeEvent(runtime, event(), handlers)).toBe('processed');
    expect(events.get('evt_once')).toMatchObject({ status: 'processed', attempts: 2, error: null });
    expect(attempt).toBe(2);
  });

  it('takes over an event whose worker crashed once its lease ran out', async () => {
    let runs = 0;
    const handlers = { 'invoice.paid': async () => void (runs += 1) };
    events.set('evt_once', { _id: 'evt_once', status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() - 1000) });
    expect(await processStripeEvent(billingRuntime(double), event(), handlers)).toBe('processed');
    expect(runs).toBe(1);
    expect(events.get('evt_once')!.attempts).toBe(2);
  });

  it('does not take over an event still inside its lease', async () => {
    events.set('evt_once', { _id: 'evt_once', status: 'processing', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) });
    expect(await processStripeEvent(billingRuntime(double), event(), { 'invoice.paid': async () => {} })).toBe('in_progress');
  });

  it('acknowledges event types it has no handler for without recording them', async () => {
    const unknown = eventFixture('customer.created', {}, { id: 'evt_other' });
    expect(await processStripeEvent(billingRuntime(double), unknown)).toBe('ignored');
    expect(events.size).toBe(0);
  });

  it('has a handler for every event type it asks Stripe to send', () => {
    expect(Object.keys(EVENT_HANDLERS).sort()).toEqual([...HANDLED_EVENT_TYPES].sort());
    expect([...HANDLED_EVENT_TYPES]).toEqual([
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
    ]);
  });
});

describe('event handlers', () => {
  const deliver = (event: ReturnType<typeof eventFixture>) => processStripeEvent(billingRuntime(double), event);
  const stripeHas = (options = {}) => {
    const subscription = subscriptionFixture({ workspaceId: WS_ID, ...options });
    double.subscriptions.set(subscription.id, subscription);
    return subscription;
  };

  it('subscription.created upgrades the workspace that owns the customer', async () => {
    stripeHas({ price: PRICES.proYearly });
    expect(await deliver(subscriptionEvent('created'))).toBe('processed');
    expect(workspace()).toMatchObject({
      plan: 'pro',
      planSource: 'stripe',
      billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', priceId: PRICES.proYearly },
    });
    expect(workspace().billing.currentPeriodEnd).toBeInstanceOf(Date);
    await flushAudits();
    expect(audits.map((audit) => audit.action)).toEqual(['billing.plan.change', 'billing.subscription.update']);
    expect(audits[0]).toMatchObject({ actorType: 'system', meta: { from: 'free', to: 'pro', subscriptionId: 'sub_1' } });
  });

  it('checkout.session.completed links the customer and upgrades, even before the subscription events', async () => {
    delete workspace().billing.stripeCustomerId;
    stripeHas({ price: PRICES.teamMonthly, quantity: 4 });
    await deliver(checkoutCompletedEvent({ workspaceId: WS_ID }));
    expect(workspace()).toMatchObject({ plan: 'team', planSource: 'stripe', billing: { stripeCustomerId: 'cus_1', seats: 4 } });
  });

  it('ignores a one-time checkout and a checkout without a subscription', async () => {
    expect(await deliver(checkoutCompletedEvent({ workspaceId: WS_ID, mode: 'payment' }))).toBe('processed');
    expect(workspace().plan).toBe('free');
    expect(double.calls.retrieve).toEqual([]);
  });

  it('applies the subscription as Stripe has it now, whatever order the events arrive in', async () => {
    // The workspace upgraded, then cancelled: Stripe's state is "canceled".
    stripeHas({ status: 'canceled' });
    // A late "created" event (it still says active) must not resurrect the plan.
    await deliver(subscriptionEvent('created', { status: 'active', created: 100 }));
    expect(workspace()).toMatchObject({ plan: 'free', planSource: 'default', billing: { status: 'canceled' } });
    await deliver(subscriptionEvent('deleted', { status: 'canceled', created: 300 }));
    expect(workspace()).toMatchObject({ plan: 'free', billing: { status: 'canceled' } });
    // And an old "updated" delivered last changes nothing either.
    await deliver(subscriptionEvent('updated', { status: 'active', created: 50 }));
    expect(workspace().plan).toBe('free');
  });

  it('downgrades on customer.subscription.deleted and clears seats', async () => {
    workspace().plan = 'team';
    workspace().planSource = 'stripe';
    workspace().billing = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', seats: 5 };
    stripeHas({ status: 'canceled', price: PRICES.teamMonthly, quantity: 5 });
    await deliver(subscriptionEvent('deleted', { status: 'canceled', price: PRICES.teamMonthly }));
    expect(workspace()).toMatchObject({ plan: 'free', planSource: 'default', billing: { status: 'canceled', seats: null } });
  });

  it('falls back to the event payload when Stripe no longer has the subscription', async () => {
    workspace().plan = 'pro';
    workspace().planSource = 'stripe';
    workspace().billing = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' };
    await deliver(subscriptionEvent('deleted', { status: 'canceled' }));
    expect(workspace()).toMatchObject({ plan: 'free', billing: { status: 'canceled' } });
  });

  it('invoice.payment_failed keeps the plan during retries and audits the failure', async () => {
    workspace().plan = 'pro';
    workspace().planSource = 'stripe';
    workspace().billing = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' };
    stripeHas({ status: 'past_due' });
    await deliver(invoiceEvent('payment_failed'));
    expect(workspace()).toMatchObject({ plan: 'pro', billing: { status: 'past_due' } });
    await flushAudits();
    const failure = audits.find((audit) => audit.action === 'billing.payment.failed');
    expect(failure?.meta).toMatchObject({ invoiceId: 'in_1', subscriptionId: 'sub_1', status: 'past_due', amountDue: 1500 });
  });

  it('invoice.paid recovers a past_due subscription (also from the legacy invoice shape)', async () => {
    workspace().plan = 'pro';
    workspace().planSource = 'stripe';
    workspace().billing = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'past_due' };
    stripeHas({ status: 'active' });
    await deliver(invoiceEvent('paid', { legacy: true }));
    expect(workspace().billing.status).toBe('active');
    expect(invoiceSubscriptionId(invoiceEvent('paid', { subscription: 'sub_x' }).data.object as any)).toBe('sub_x');
    expect(invoiceSubscriptionId({ id: 'in_2' } as any)).toBeNull();
  });

  it('ignores an invoice that belongs to no subscription', async () => {
    const invoice = eventFixture('invoice.paid', { id: 'in_one_off', object: 'invoice' });
    expect(await deliver(invoice)).toBe('processed');
    expect(double.calls.retrieve).toEqual([]);
  });

  it('never overwrites a plan set by hand, only records the billing fields', async () => {
    workspace().plan = 'enterprise';
    workspace().planSource = 'manual';
    stripeHas({ price: PRICES.proMonthly });
    await deliver(subscriptionEvent('created'));
    expect(workspace()).toMatchObject({ plan: 'enterprise', planSource: 'manual', billing: { status: 'active', stripeSubscriptionId: 'sub_1' } });
    stripeHas({ status: 'canceled' });
    await deliver(subscriptionEvent('deleted'));
    expect(workspace()).toMatchObject({ plan: 'enterprise', planSource: 'manual', billing: { status: 'canceled' } });
  });

  it('does not downgrade when a plan turns manual between the read and the write', async () => {
    workspace().plan = 'pro';
    workspace().planSource = 'stripe';
    workspace().billing = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' };
    stripeHas({ status: 'canceled' });
    const realFindOne = (WorkspaceModel as any).findOne;
    (WorkspaceModel as any).findOne = async (filter: Doc) => {
      const found = await realFindOne(filter);
      // The administrator pins the plan right after the webhook read the workspace.
      workspace().planSource = 'manual';
      return found;
    };
    await deliver(subscriptionEvent('deleted'));
    expect(workspace()).toMatchObject({ plan: 'pro', planSource: 'manual', billing: { status: 'canceled' } });
  });

  it('ignores a subscription no workspace owns', async () => {
    double.subscriptions.set('sub_orphan', subscriptionFixture({ id: 'sub_orphan', customer: 'cus_unknown' }));
    expect(await deliver(subscriptionEvent('created', { id: 'sub_orphan', customer: 'cus_unknown' }))).toBe('processed');
    expect(workspace().plan).toBe('free');
    expect(consoleWarn).toHaveBeenCalled();
  });

  it('will not hand a workspace that has its own customer to another customer', async () => {
    stripeHas({ customer: 'cus_stranger' });
    await deliver(subscriptionEvent('created', { customer: 'cus_stranger' }));
    expect(workspace()).toMatchObject({ plan: 'free', billing: { stripeCustomerId: 'cus_1' } });
  });

  it('leaves the plan alone for a price this server has no mapping for, and says so', async () => {
    stripeHas({ price: 'price_legacy' });
    await deliver(subscriptionEvent('created', { price: 'price_legacy' }));
    expect(workspace()).toMatchObject({ plan: 'free', billing: { status: 'active', priceId: 'price_legacy' } });
    expect(consoleError).toHaveBeenCalled();
  });

  it('replaying the same event is harmless', async () => {
    stripeHas();
    const event = subscriptionEvent('created', { eventId: 'evt_replay' });
    expect(await deliver(event)).toBe('processed');
    const after = JSON.stringify(workspace());
    expect(await deliver(event)).toBe('duplicate');
    expect(JSON.stringify(workspace())).toBe(after);
    expect(double.calls.retrieve).toEqual(['sub_1']);
  });

  it('a Stripe outage fails the event so Stripe retries it', async () => {
    double.fail.retrieve = new Error('stripe unreachable');
    stripeHas();
    await expect(deliver(subscriptionEvent('created', { eventId: 'evt_down' }))).rejects.toThrow('stripe unreachable');
    expect(events.get('evt_down')?.status).toBe('failed');
    delete double.fail.retrieve;
    expect(await deliver(subscriptionEvent('created', { eventId: 'evt_down' }))).toBe('processed');
    expect(workspace().plan).toBe('pro');
  });

  it('flags a second entitled subscription that replaces a billing one', async () => {
    workspace().plan = 'pro';
    workspace().planSource = 'stripe';
    workspace().billing = { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' };
    stripeHas({ id: 'sub_2', price: PRICES.teamYearly, quantity: 2 });
    await deliver(subscriptionEvent('created', { id: 'sub_2', price: PRICES.teamYearly }));
    expect(workspace()).toMatchObject({ plan: 'team', billing: { stripeSubscriptionId: 'sub_2' } });
    await flushAudits();
    expect(audits.find((audit) => audit.action === 'billing.subscription.replaced')?.meta).toEqual({
      subscriptionId: 'sub_2',
      replacedSubscriptionId: 'sub_1',
    });
  });
});
