/**
 * Stripe fixtures for the billing tests: event and object builders shaped like
 * the API payloads the module reads, and a Stripe client double that serves
 * subscriptions from a map and records the calls billing makes.
 */
import Stripe from 'stripe';
import type { BillingRuntime, StripeClient } from '../../../src/modules/billing/stripe';

export const WEBHOOK_SECRET = 'whsec_test_fixture_secret';

export const PRICES = {
  proMonthly: 'price_pro_monthly',
  proYearly: 'price_pro_yearly',
  teamMonthly: 'price_team_monthly',
  teamYearly: 'price_team_yearly',
} as const;

/** Seconds since the epoch, `days` from `from`. */
export const inDays = (days: number, from = Date.UTC(2026, 9, 19)) => Math.floor((from + days * 86_400_000) / 1000);

export interface SubscriptionFixtureOptions {
  id?: string;
  customer?: string;
  status?: string;
  price?: string;
  quantity?: number;
  itemId?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  workspaceId?: string | null;
  /** Put current_period_end on the subscription (API before 2025-03-31) instead of on the item. */
  legacyPeriodEnd?: boolean;
  extraItems?: unknown[];
}

export function subscriptionFixture(options: SubscriptionFixtureOptions = {}): Stripe.Subscription {
  const {
    id = 'sub_1',
    customer = 'cus_1',
    status = 'active',
    price = PRICES.proMonthly,
    quantity = 1,
    itemId = 'si_1',
    periodEnd = inDays(30),
    cancelAtPeriodEnd = false,
    workspaceId = null,
    legacyPeriodEnd = false,
    extraItems = [],
  } = options;
  return {
    id,
    object: 'subscription',
    customer,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: null,
    metadata: workspaceId ? { workspaceId } : {},
    ...(legacyPeriodEnd ? { current_period_end: periodEnd } : {}),
    items: {
      object: 'list',
      data: [
        ...extraItems,
        { id: itemId, object: 'subscription_item', price: { id: price }, quantity, ...(legacyPeriodEnd ? {} : { current_period_end: periodEnd }) },
      ],
    },
  } as unknown as Stripe.Subscription;
}

let eventCounter = 0;

export function eventFixture(type: string, object: unknown, options: { id?: string; created?: number } = {}): Stripe.Event {
  eventCounter += 1;
  return {
    id: options.id ?? `evt_${eventCounter}`,
    object: 'event',
    type,
    livemode: false,
    created: options.created ?? inDays(0),
    data: { object },
  } as unknown as Stripe.Event;
}

export const subscriptionEvent = (
  type: 'created' | 'updated' | 'deleted',
  options: SubscriptionFixtureOptions & { eventId?: string; created?: number } = {},
) =>
  eventFixture(`customer.subscription.${type}`, subscriptionFixture(options), {
    id: options.eventId,
    created: options.created,
  });

export function checkoutCompletedEvent(
  options: { workspaceId: string; customer?: string; subscription?: string; mode?: string; eventId?: string } ,
): Stripe.Event {
  const { workspaceId, customer = 'cus_1', subscription = 'sub_1', mode = 'subscription', eventId } = options;
  return eventFixture(
    'checkout.session.completed',
    {
      id: 'cs_test_1',
      object: 'checkout.session',
      mode,
      customer,
      subscription: mode === 'subscription' ? subscription : null,
      client_reference_id: workspaceId,
      metadata: { workspaceId },
    },
    { id: eventId },
  );
}

export function invoiceEvent(
  type: 'paid' | 'payment_failed',
  options: { subscription?: string; legacy?: boolean; eventId?: string } = {},
): Stripe.Event {
  const { subscription = 'sub_1', legacy = false, eventId } = options;
  return eventFixture(
    `invoice.${type}`,
    {
      id: 'in_1',
      object: 'invoice',
      attempt_count: 1,
      amount_due: 1500,
      currency: 'usd',
      ...(legacy ? { subscription } : { parent: { type: 'subscription_details', subscription_details: { subscription } } }),
    },
    { id: eventId },
  );
}

/** What a webhook delivery carries: the exact payload bytes and a valid Stripe-Signature header. */
export async function signedDelivery(event: Stripe.Event, secret = WEBHOOK_SECRET) {
  const payload = JSON.stringify(event);
  const signature = await new Stripe('sk_test_fixture').webhooks.generateTestHeaderStringAsync({ payload, secret });
  return { payload, signature };
}

export interface StripeDouble {
  client: StripeClient;
  /** Subscriptions `subscriptions.retrieve` serves (set the state the "API" is in). */
  subscriptions: Map<string, Stripe.Subscription>;
  prices: Map<string, Record<string, unknown>>;
  calls: {
    customersCreate: any[];
    checkoutCreate: any[];
    portalCreate: any[];
    subscriptionsUpdate: any[];
    retrieve: string[];
  };
  /** Make the next call of this kind throw. */
  fail: { customers?: Error; checkout?: Error; portal?: Error; retrieve?: Error };
}

const notFound = () => Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 });

export function stripeDouble(): StripeDouble {
  const double: StripeDouble = {
    subscriptions: new Map(),
    prices: new Map(),
    calls: { customersCreate: [], checkoutCreate: [], portalCreate: [], subscriptionsUpdate: [], retrieve: [] },
    fail: {},
    client: undefined as unknown as StripeClient,
  };
  let customerSeq = 0;
  const real = new Stripe('sk_test_fixture');
  double.client = {
    webhooks: real.webhooks,
    customers: {
      create: async (params: unknown, options: unknown) => {
        double.calls.customersCreate.push({ params, options });
        if (double.fail.customers) throw double.fail.customers;
        customerSeq += 1;
        return { id: `cus_created_${customerSeq}` };
      },
    },
    checkout: {
      sessions: {
        create: async (params: unknown, options: unknown) => {
          double.calls.checkoutCreate.push({ params, options });
          if (double.fail.checkout) throw double.fail.checkout;
          return { id: 'cs_test_created', url: 'https://checkout.stripe.test/c/pay/cs_test_created' };
        },
      },
    },
    billingPortal: {
      sessions: {
        create: async (params: unknown) => {
          double.calls.portalCreate.push(params);
          if (double.fail.portal) throw double.fail.portal;
          return { id: 'bps_1', url: 'https://billing.stripe.test/p/session/bps_1' };
        },
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        double.calls.retrieve.push(id);
        if (double.fail.retrieve) throw double.fail.retrieve;
        const subscription = double.subscriptions.get(id);
        if (!subscription) throw notFound();
        return subscription;
      },
      update: async (id: string, params: any) => {
        double.calls.subscriptionsUpdate.push({ id, params });
        const subscription = double.subscriptions.get(id);
        if (!subscription) throw notFound();
        const quantity = params?.items?.[0]?.quantity;
        if (typeof quantity === 'number') {
          (subscription.items.data[0] as { quantity: number }).quantity = quantity;
        }
        return subscription;
      },
    },
    prices: {
      retrieve: async (id: string) => {
        const price = double.prices.get(id);
        if (!price) throw notFound();
        return price;
      },
    },
  } as unknown as StripeClient;
  return double;
}

export function billingRuntime(double: StripeDouble, overrides: Partial<BillingRuntime> = {}): BillingRuntime {
  return {
    config: { secretKey: 'sk_test_fixture', webhookSecret: WEBHOOK_SECRET, prices: { ...PRICES } },
    stripe: double.client,
    automaticTax: false,
    ...overrides,
  };
}

export const recurringPrice = (id: string, interval: 'month' | 'year', unitAmount: number, currency = 'USD') => ({
  id,
  active: true,
  type: 'recurring',
  billing_scheme: 'per_unit',
  unit_amount: unitAmount,
  currency,
  recurring: { interval, interval_count: 1 },
});
