import type { BillingConfig } from './stripe';

/**
 * Stripe price ids ↔ plans. Each paid plan has a monthly and a yearly price
 * (STRIPE_PRICE_{PRO,TEAM}_{MONTHLY,YEARLY}); Team prices are per seat.
 */

export const PAID_PLAN_IDS = ['pro', 'team'] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export const BILLING_INTERVALS = ['monthly', 'yearly'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export type PriceIds = BillingConfig['prices'];

const PRICE_KEYS: Record<PaidPlanId, Record<BillingInterval, keyof PriceIds>> = {
  pro: { monthly: 'proMonthly', yearly: 'proYearly' },
  team: { monthly: 'teamMonthly', yearly: 'teamYearly' },
};

/** Plans billed per seat: the subscription quantity is the number of seats. */
export const PER_SEAT_PLANS: ReadonlySet<PaidPlanId> = new Set(['team']);

/** The configured price id for a plan and interval, or null. */
export function priceIdFor(prices: PriceIds, plan: PaidPlanId, interval: BillingInterval): string | null {
  return prices[PRICE_KEYS[plan][interval]] ?? null;
}

/** Which plan and interval a Stripe price id stands for, or null for an unknown price. */
export function planForPrice(
  prices: PriceIds,
  priceId: string | null | undefined,
): { plan: PaidPlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_IDS) {
    for (const interval of BILLING_INTERVALS) {
      if (priceIdFor(prices, plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
}

/** Plan → interval → whether checkout can sell it (a price id is configured). */
export function checkoutAvailability(prices: PriceIds | null): Record<PaidPlanId, Record<BillingInterval, boolean>> {
  const available = (plan: PaidPlanId, interval: BillingInterval) =>
    prices !== null && priceIdFor(prices, plan, interval) !== null;
  return {
    pro: { monthly: available('pro', 'monthly'), yearly: available('pro', 'yearly') },
    team: { monthly: available('team', 'monthly'), yearly: available('team', 'yearly') },
  };
}
