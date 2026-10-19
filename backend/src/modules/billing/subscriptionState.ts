import type Stripe from 'stripe';
import { isPlanId, type PlanId } from '../../common/plans/plans';
import { PER_SEAT_PLANS, planForPrice, type PriceIds } from './prices';
import { stripeId } from './stripe';

/**
 * Pure rules that turn a Stripe subscription into the workspace's plan and
 * billing fields. No I/O: subscriptionSync.ts reads and writes.
 */

/** Statuses that keep the paid plan. `past_due`: Stripe is still retrying the payment. */
export const ENTITLED_STATUSES = ['active', 'trialing', 'past_due'] as const;

export const isEntitledStatus = (status: string | null | undefined): boolean =>
  typeof status === 'string' && (ENTITLED_STATUSES as readonly string[]).includes(status);

/** What the billing module keeps from a Stripe subscription. */
export interface SubscriptionSnapshot {
  id: string;
  customerId: string | null;
  status: string;
  /** Price of the plan item (the first item whose price maps to a plan, else the first item). */
  priceId: string | null;
  /** Item id of that plan item, for quantity updates. */
  itemId: string | null;
  quantity: number | null;
  currentPeriodEnd: Date | null;
  /** Cancellation scheduled (at period end or at a set date). */
  cancelAtPeriodEnd: boolean;
  /** `subscription_data.metadata.workspaceId`, set by checkout. */
  workspaceId: string | null;
}

const toDate = (seconds: unknown): Date | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? new Date(seconds * 1000) : null;

export function snapshotFromSubscription(subscription: Stripe.Subscription, prices: PriceIds): SubscriptionSnapshot {
  const items = subscription.items?.data ?? [];
  const item = items.find((candidate) => planForPrice(prices, candidate.price?.id) !== null) ?? items[0] ?? null;
  // current_period_end moved from the subscription to its items in API 2025-03-31; read both.
  const legacyPeriodEnd = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const metadataWorkspace = subscription.metadata?.workspaceId;
  return {
    id: subscription.id,
    customerId: stripeId(subscription.customer),
    status: subscription.status,
    priceId: item?.price?.id ?? null,
    itemId: item?.id ?? null,
    quantity: typeof item?.quantity === 'number' ? item.quantity : null,
    currentPeriodEnd: toDate(item?.current_period_end ?? legacyPeriodEnd),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    workspaceId: typeof metadataWorkspace === 'string' && metadataWorkspace ? metadataWorkspace : null,
  };
}

/** The workspace fields the decision reads (a Workspace document satisfies it). */
export interface BillingWorkspace {
  plan?: string | null;
  planSource?: string | null;
  billing?: {
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    status?: string | null;
    seats?: number | null;
  } | null;
}

export type SubscriptionDecision =
  | { apply: false; reason: 'stale_subscription' }
  | {
      apply: true;
      /** `$set` for the workspace. */
      set: Record<string, unknown>;
      /** The workspace's plan after the update. */
      plan: PlanId;
      previousPlan: PlanId;
      /** planSource 'manual': billing fields recorded, plan left alone. */
      managedManually: boolean;
      /** Entitled subscription on a price no STRIPE_PRICE_* names: plan left alone. */
      unknownPrice: boolean;
      /**
       * A new entitled subscription took over from one that was still
       * entitled (two checkouts completed): the old one keeps billing and
       * needs cancelling by hand.
       */
      replacedSubscriptionId: string | null;
    };

/**
 * How a subscription's current state changes the workspace:
 *
 * - A subscription other than the workspace's current one only takes over
 *   when it is entitled (a new checkout after a cancellation). Late events of
 *   an old, ended subscription never downgrade the workspace.
 * - Entitled (active, trialing, past_due) on a known price → that plan,
 *   `planSource: 'stripe'`; per-seat plans record the quantity as seats.
 * - Not entitled (canceled, unpaid, incomplete, incomplete_expired, paused)
 *   → Free, `planSource: 'default'`, purchased seats cleared.
 * - `planSource: 'manual'` (scripts/set-plan.ts) is never overwritten: only
 *   the billing fields are recorded.
 */
export function decideSubscriptionUpdate(
  workspace: BillingWorkspace,
  snapshot: SubscriptionSnapshot,
  prices: PriceIds,
): SubscriptionDecision {
  const entitled = isEntitledStatus(snapshot.status);
  const currentSubscription = workspace.billing?.stripeSubscriptionId ?? null;
  if (currentSubscription && currentSubscription !== snapshot.id && !entitled) {
    return { apply: false, reason: 'stale_subscription' };
  }

  const set: Record<string, unknown> = {
    'billing.stripeSubscriptionId': snapshot.id,
    'billing.status': snapshot.status,
    'billing.priceId': snapshot.priceId,
    'billing.currentPeriodEnd': snapshot.currentPeriodEnd,
    'billing.cancelAtPeriodEnd': snapshot.cancelAtPeriodEnd,
  };
  if (snapshot.customerId && !workspace.billing?.stripeCustomerId) {
    set['billing.stripeCustomerId'] = snapshot.customerId;
  }

  const previousPlan: PlanId = isPlanId(workspace.plan) ? workspace.plan : 'free';
  const replacedSubscriptionId =
    currentSubscription && currentSubscription !== snapshot.id && entitled && isEntitledStatus(workspace.billing?.status)
      ? currentSubscription
      : null;
  const unchanged = { apply: true as const, set, plan: previousPlan, previousPlan, replacedSubscriptionId };

  if (workspace.planSource === 'manual') return { ...unchanged, managedManually: true, unknownPrice: false };

  const mapped = planForPrice(prices, snapshot.priceId);
  if (entitled && !mapped) return { ...unchanged, managedManually: false, unknownPrice: true };

  const plan: PlanId = entitled && mapped ? mapped.plan : 'free';
  set.plan = plan;
  set.planSource = entitled ? 'stripe' : 'default';
  set['billing.seats'] =
    entitled && mapped && PER_SEAT_PLANS.has(mapped.plan) ? Math.max(1, snapshot.quantity ?? 1) : null;

  return { apply: true, set, plan, previousPlan, managedManually: false, unknownPrice: false, replacedSubscriptionId };
}
