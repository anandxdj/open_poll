import { FEATURES, LIMIT_KEYS, PLAN_IDS, PLANS, type Feature, type LimitKey, type PlanId } from '../../common/plans/plans';
import { BILLING_INTERVALS, PER_SEAT_PLANS, checkoutAvailability, priceIdFor, type BillingInterval, type PaidPlanId } from './prices';
import { getBillingRuntime, type BillingRuntime } from './stripe';

/**
 * The public plan catalogue behind GET /api/plans: limits and features come
 * from common/plans/plans.ts, prices from Stripe, and only for the prices the
 * server is configured with. Without billing (or when Stripe cannot be
 * reached) a plan simply has no price: the page shows its limits and the
 * frontend never invents a number.
 */

export interface PlanPrice {
  /** Minor units (cents) of one billing period: a year for the yearly price. */
  amount: number;
  /** Lower-case ISO 4217 code. */
  currency: string;
}

export interface CatalogPlan {
  id: PlanId;
  name: string;
  limits: Record<LimitKey, number | null>;
  features: Record<Feature, boolean>;
  /** The price is per seat (Team). */
  perSeat: boolean;
  /** null when no price is configured (Free, Enterprise, or billing disabled). */
  prices: Record<BillingInterval, PlanPrice | null> | null;
  /** Whether checkout can sell this plan at each interval right now. */
  checkout: Record<BillingInterval, boolean>;
}

export interface PlanCatalog {
  /** Stripe billing is configured on this server. */
  billingEnabled: boolean;
  plans: CatalogPlan[];
}

const STRIPE_INTERVAL: Record<BillingInterval, string> = { monthly: 'month', yearly: 'year' };
const PRICE_TTL_MS = 10 * 60_000;
/** A failed lookup is retried after this long, so a Stripe outage does not turn every page view into API calls. */
const FAILURE_TTL_MS = 60_000;

interface CachedPrice {
  value: PlanPrice | null;
  expiresAt: number;
}

const priceCache = new Map<string, CachedPrice>();
const inFlight = new Map<string, Promise<PlanPrice | null>>();

export function clearPriceCache(): void {
  priceCache.clear();
  inFlight.clear();
}

async function fetchPrice(runtime: BillingRuntime, priceId: string, interval: BillingInterval): Promise<PlanPrice | null> {
  try {
    const price = await runtime.stripe.prices.retrieve(priceId);
    const valid =
      price.active &&
      price.type === 'recurring' &&
      price.billing_scheme === 'per_unit' &&
      price.recurring?.interval === STRIPE_INTERVAL[interval] &&
      price.recurring.interval_count === 1 &&
      typeof price.unit_amount === 'number';
    if (!valid) {
      console.error(`[Billing] Price ${priceId} is not an active ${STRIPE_INTERVAL[interval]}ly per-unit price; its amount is not shown`);
      return null;
    }
    return { amount: price.unit_amount as number, currency: price.currency.toLowerCase() };
  } catch (error) {
    console.error(`[Billing] Could not read price ${priceId}:`, (error as Error)?.message);
    return null;
  }
}

async function priceFor(runtime: BillingRuntime, priceId: string, interval: BillingInterval): Promise<PlanPrice | null> {
  const cached = priceCache.get(priceId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = inFlight.get(priceId);
  if (pending) return pending;

  const request = fetchPrice(runtime, priceId, interval)
    .then((value) => {
      priceCache.set(priceId, { value, expiresAt: Date.now() + (value ? PRICE_TTL_MS : FAILURE_TTL_MS) });
      return value;
    })
    .finally(() => inFlight.delete(priceId));
  inFlight.set(priceId, request);
  return request;
}

export async function getPlanCatalog(runtime: BillingRuntime | null = getBillingRuntime()): Promise<PlanCatalog> {
  const availability = checkoutAvailability(runtime?.config.prices ?? null);

  const plans = await Promise.all(
    PLAN_IDS.map(async (id): Promise<CatalogPlan> => {
      const definition = PLANS[id];
      const paid = id === 'pro' || id === 'team';
      let prices: CatalogPlan['prices'] = null;
      if (runtime && paid) {
        const entries = await Promise.all(
          BILLING_INTERVALS.map(async (interval) => {
            const priceId = priceIdFor(runtime.config.prices, id as PaidPlanId, interval);
            return [interval, priceId ? await priceFor(runtime, priceId, interval) : null] as const;
          }),
        );
        prices = Object.fromEntries(entries) as Record<BillingInterval, PlanPrice | null>;
      }
      return {
        id,
        name: definition.name,
        limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, definition.limits[key]])) as CatalogPlan['limits'],
        features: Object.fromEntries(FEATURES.map((key) => [key, definition.features[key]])) as CatalogPlan['features'],
        perSeat: paid && PER_SEAT_PLANS.has(id as PaidPlanId),
        prices,
        checkout: paid ? availability[id as PaidPlanId] : { monthly: false, yearly: false },
      };
    }),
  );

  return { billingEnabled: runtime !== null, plans };
}
