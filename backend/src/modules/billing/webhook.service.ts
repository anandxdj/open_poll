import type Stripe from 'stripe';
import { audit } from '../../common/audit/audit';
import { ApiError } from '../../common/utils/ApiError';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { STRIPE_EVENT_RETENTION_DAYS, StripeEventModel } from './stripeEvent.model';
import { stripeId, type BillingRuntime } from './stripe';
import { syncSubscription } from './subscriptionSync';

/**
 * Stripe webhook: signature check, exactly-once processing and the handlers.
 * Configure the endpoint with exactly HANDLED_EVENT_TYPES (docs/wiki/modules/billing.md).
 */

export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
] as const;
export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export type EventHandler = (runtime: BillingRuntime, event: Stripe.Event) => Promise<void>;

/** A delivery's outcome; `in_progress` (another delivery holds the event) answers 409 so Stripe retries. */
export type ProcessOutcome = 'processed' | 'duplicate' | 'ignored' | 'in_progress';

/** A worker that crashed mid-event loses it after this long; Stripe's next retry takes it over. */
export const EVENT_LEASE_MS = 2 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

/** 400 unless `body` is the raw payload Stripe signed with STRIPE_WEBHOOK_SECRET. */
export async function verifyStripeEvent(runtime: BillingRuntime, body: unknown, signature: unknown): Promise<Stripe.Event> {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ApiError(400, 'Expected the raw JSON payload signed by Stripe', 'WEBHOOK_PAYLOAD_INVALID');
  }
  if (typeof signature !== 'string' || !signature) {
    throw new ApiError(400, 'Missing Stripe-Signature header', 'WEBHOOK_SIGNATURE_INVALID');
  }
  try {
    return await runtime.stripe.webhooks.constructEventAsync(body, signature, runtime.config.webhookSecret);
  } catch {
    throw new ApiError(400, 'Invalid Stripe signature', 'WEBHOOK_SIGNATURE_INVALID');
  }
}

/**
 * Claims the event before any side effect: the insert of `_id = event.id` is
 * atomic, so only one delivery wins. A record left `failed`, or `processing`
 * past its lease (crashed worker), is taken over atomically by the next
 * delivery.
 */
async function claimEvent(event: Stripe.Event): Promise<'claimed' | 'duplicate' | 'in_progress'> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + EVENT_LEASE_MS);
  try {
    await StripeEventModel.create({
      _id: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      status: 'processing',
      attempts: 1,
      leaseUntil,
      eventCreatedAt: typeof event.created === 'number' ? new Date(event.created * 1000) : null,
      expiresAt: new Date(now.getTime() + STRIPE_EVENT_RETENTION_DAYS * DAY_MS),
    });
    return 'claimed';
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }

  const taken = await StripeEventModel.findOneAndUpdate(
    { _id: event.id, $or: [{ status: 'failed' }, { status: 'processing', leaseUntil: { $lt: now } }] },
    { $set: { status: 'processing', leaseUntil, error: null }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (taken) return 'claimed';

  const existing = await StripeEventModel.findById(event.id).select('status').lean();
  return existing?.status === 'processed' ? 'duplicate' : 'in_progress';
}

/**
 * Runs the event's handler exactly once. Event types without a handler are
 * acknowledged without a record. A handler error marks the event `failed` and
 * is rethrown (the webhook answers 500, so Stripe retries and the retry takes
 * the event over).
 */
export async function processStripeEvent(
  runtime: BillingRuntime,
  event: Stripe.Event,
  handlers: Partial<Record<string, EventHandler>> = EVENT_HANDLERS,
): Promise<ProcessOutcome> {
  const handler = handlers[event.type];
  if (!handler) return 'ignored';

  const claim = await claimEvent(event);
  if (claim !== 'claimed') return claim;

  try {
    await handler(runtime, event);
  } catch (error) {
    await StripeEventModel.updateOne(
      { _id: event.id },
      { $set: { status: 'failed', leaseUntil: null, error: String((error as Error)?.message ?? error).slice(0, 500) } },
    ).catch((updateError: unknown) =>
      console.error(`[Billing] Failed to mark event ${event.id} as failed:`, (updateError as Error)?.message),
    );
    throw error;
  }
  await StripeEventModel.updateOne(
    { _id: event.id },
    { $set: { status: 'processed', processedAt: new Date(), leaseUntil: null, error: null } },
  );
  return 'processed';
}

/** Subscription of an invoice; API 2025-03-31 moved it under `parent.subscription_details`. */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: unknown }).subscription;
  return stripeId(invoice.parent?.subscription_details?.subscription) ?? stripeId(legacy);
}

const onCheckoutCompleted: EventHandler = async (runtime, event) => {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'subscription') return;
  const subscriptionId = stripeId(session.subscription);
  if (!subscriptionId) return;

  const workspaceId = session.client_reference_id ?? session.metadata?.workspaceId ?? null;
  const customerId = stripeId(session.customer);
  if (workspaceId && OBJECT_ID.test(workspaceId) && customerId) {
    // Checkout normally reuses the customer created for the workspace; link it if it is new.
    await WorkspaceModel.updateOne(
      { _id: workspaceId, 'billing.stripeCustomerId': null },
      { $set: { 'billing.stripeCustomerId': customerId } },
    ).catch((error: unknown) => {
      if (!isDuplicateKey(error)) throw error;
      console.warn(`[Billing] Customer ${customerId} already belongs to another workspace; not linked to ${workspaceId}`);
    });
  }
  await syncSubscription(runtime, subscriptionId, { workspaceIdHint: workspaceId });
};

const onSubscriptionEvent: EventHandler = async (runtime, event) => {
  const subscription = event.data.object as Stripe.Subscription;
  await syncSubscription(runtime, subscription.id, { fallback: subscription });
};

const onInvoiceEvent: EventHandler = async (runtime, event) => {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return;
  const result = await syncSubscription(runtime, subscriptionId);
  if (event.type === 'invoice.payment_failed' && result.outcome === 'applied') {
    void audit(
      { actorType: 'system', workspace: { _id: result.workspaceId, plan: result.plan } },
      'billing.payment.failed',
      { type: 'workspace', id: result.workspaceId },
      {
        invoiceId: invoice.id ?? null,
        subscriptionId,
        status: result.status,
        attemptCount: invoice.attempt_count ?? null,
        amountDue: invoice.amount_due ?? null,
        currency: invoice.currency ?? null,
      },
    );
  }
};

export const EVENT_HANDLERS: Record<HandledEventType, EventHandler> = {
  'checkout.session.completed': onCheckoutCompleted,
  'customer.subscription.created': onSubscriptionEvent,
  'customer.subscription.updated': onSubscriptionEvent,
  'customer.subscription.deleted': onSubscriptionEvent,
  'invoice.paid': onInvoiceEvent,
  'invoice.payment_failed': onInvoiceEvent,
};
