import Stripe from 'stripe';
import { env } from '../../common/config/env';
import { getEntitlements, type Entitlements } from '../../common/plans/entitlements';
import { USAGE_COUNTERS, type PlanId, type UsageCounterName } from '../../common/plans/plans';
import { getUsage } from '../../common/plans/usage';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { ApiError } from '../../common/utils/ApiError';
import { UserModel } from '../auth/auth.model';
import { WorkspaceModel, type IWorkspace } from '../workspaces/workspace.model';
import { WorkspaceMemberModel, type IWorkspaceMember } from '../workspaces/workspaceMember.model';
import { MAX_SEATS, type CheckoutInput } from './billing.schema';
import {
  PER_SEAT_PLANS,
  checkoutAvailability,
  planForPrice,
  priceIdFor,
  type BillingInterval,
  type PaidPlanId,
} from './prices';
import { billingDisabledError, getBillingRuntime, requireBilling, type BillingRuntime } from './stripe';
import { isEntitledStatus } from './subscriptionState';

/** Someone acting on the current workspace: a request after authenticate() + workspaceContext(). */
export interface BillingActor extends PolicyContext {
  user: { id: string };
  workspace: IWorkspace;
  membership: IWorkspaceMember;
}

export interface UsageMeter {
  counter: UsageCounterName;
  /** The plan limit this counter consumes. */
  limitKey: (typeof USAGE_COUNTERS)[UsageCounterName];
  /** yyyymm, UTC. */
  period: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  remaining: number | null;
}

export interface BillingOverview {
  /** Stripe billing is configured on this server. */
  enabled: boolean;
  workspace: { _id: string; name: string; type: IWorkspace['type'] };
  plan: PlanId;
  /** `manual` plans are assigned by an administrator and ignore Stripe. */
  planSource: IWorkspace['planSource'];
  /** Stripe subscription status, or null when the workspace has no subscription. */
  status: string | null;
  /** What the subscription is for; null without one or for a price this server does not know. */
  subscription: { plan: PaidPlanId; interval: BillingInterval } | null;
  currentPeriodEnd: Date | null;
  /** The subscription ends at the end of the current period. */
  cancelAtPeriodEnd: boolean;
  /** The last payment failed and Stripe is retrying; the plan stays until it gives up. */
  paymentFailed: boolean;
  seats: {
    /** Active members. */
    used: number;
    /** What the plan allows: purchased seats on Team, else the plan's limit. null = unlimited. */
    limit: number | null;
    /** Seats on the Stripe subscription, for per-seat plans. */
    purchased: number | null;
  };
  usage: UsageMeter[];
  entitlements: Entitlements;
  /** Whether the Billing Portal can be opened (billing on, and a Stripe customer exists). */
  canOpenPortal: boolean;
  /** Plan → interval → whether checkout can start now (billing on, price configured, nothing blocks it). */
  checkout: Record<PaidPlanId, Record<BillingInterval, boolean>>;
  /** Why checkout is unavailable even though billing is on: a subscription or a manual plan. */
  checkoutBlockedReason: 'already_subscribed' | 'plan_managed_manually' | null;
}

const countActiveMembers = (workspaceId: IWorkspace['_id']) =>
  WorkspaceMemberModel.countDocuments({ workspaceId, status: 'active' });

/** Why a workspace cannot start a new subscription, if it cannot. */
export function checkoutBlock(workspace: IWorkspace): 'already_subscribed' | 'plan_managed_manually' | null {
  if (workspace.planSource === 'manual') return 'plan_managed_manually';
  if (workspace.billing?.stripeSubscriptionId && isEntitledStatus(workspace.billing.status)) return 'already_subscribed';
  return null;
}

export async function getBillingOverview(actor: BillingActor): Promise<BillingOverview> {
  assertCan(actor, 'workspace:billing');
  const { workspace } = actor;
  const runtime = getBillingRuntime();
  const entitlements = getEntitlements(workspace);
  const billing = workspace.billing ?? {};

  const [members, ...usage] = await Promise.all([
    countActiveMembers(workspace._id),
    ...(Object.keys(USAGE_COUNTERS) as UsageCounterName[]).map((counter) => getUsage(workspace, counter)),
  ]);

  const mapped = runtime ? planForPrice(runtime.config.prices, billing.priceId) : null;
  const blocked = runtime ? checkoutBlock(workspace) : null;
  const available = checkoutAvailability(runtime?.config.prices ?? null);
  const checkout = Object.fromEntries(
    (['pro', 'team'] as const).map((plan) => [
      plan,
      {
        monthly: available[plan].monthly && !blocked,
        yearly: available[plan].yearly && !blocked,
      },
    ]),
  ) as BillingOverview['checkout'];

  return {
    enabled: runtime !== null,
    workspace: { _id: String(workspace._id), name: workspace.name, type: workspace.type },
    plan: entitlements.plan,
    planSource: workspace.planSource ?? 'default',
    status: billing.stripeSubscriptionId ? (billing.status ?? null) : null,
    subscription: mapped,
    currentPeriodEnd: billing.stripeSubscriptionId ? (billing.currentPeriodEnd ?? null) : null,
    cancelAtPeriodEnd: Boolean(billing.stripeSubscriptionId && billing.cancelAtPeriodEnd),
    paymentFailed: billing.status === 'past_due',
    seats: {
      used: members,
      limit: entitlements.limits.seats,
      purchased: typeof billing.seats === 'number' && billing.seats > 0 ? billing.seats : null,
    },
    usage: usage.map((meter) => ({
      counter: meter.counter,
      limitKey: USAGE_COUNTERS[meter.counter],
      period: meter.period,
      used: meter.used,
      limit: meter.limit,
      remaining: meter.remaining,
    })),
    entitlements,
    canOpenPortal: runtime !== null && Boolean(billing.stripeCustomerId),
    checkout,
    checkoutBlockedReason: blocked,
  };
}

/** Stripe failures never reach the client verbatim: log them, answer 502. */
function providerError(action: string, error: unknown): ApiError {
  console.error(`[Billing] Stripe ${action} failed:`, (error as Error)?.message);
  return new ApiError(502, 'The payment provider could not complete the request', 'BILLING_PROVIDER_ERROR');
}

/** The workspace's Stripe customer, created on first use. One customer per workspace, race-safe. */
async function ensureCustomer(runtime: BillingRuntime, actor: BillingActor): Promise<string> {
  const { workspace } = actor;
  const existing = workspace.billing?.stripeCustomerId;
  if (existing) return existing;

  const user = await UserModel.findById(actor.user.id).select('email name');
  const workspaceId = String(workspace._id);
  let customerId: string;
  try {
    const customer = await runtime.stripe.customers.create(
      {
        name: workspace.name,
        ...(user?.email ? { email: user.email } : {}),
        metadata: { workspaceId, openpollOwnerId: String(workspace.ownerId) },
      },
      // Concurrent first checkouts of one workspace get the same customer back.
      { idempotencyKey: `openpoll-customer-${workspaceId}` },
    );
    customerId = customer.id;
  } catch (error) {
    throw providerError('customer creation', error);
  }

  const claimed = await WorkspaceModel.updateOne(
    { _id: workspace._id, 'billing.stripeCustomerId': null },
    { $set: { 'billing.stripeCustomerId': customerId } },
  );
  if (claimed.matchedCount === 0) {
    const current = await WorkspaceModel.findById(workspace._id).select('billing.stripeCustomerId').lean();
    const winner = current?.billing?.stripeCustomerId;
    if (winner) return winner;
    throw ApiError.notFound('Workspace not found');
  }
  return customerId;
}

export interface CheckoutResult {
  /** Stripe-hosted Checkout page to send the browser to. */
  url: string;
  sessionId: string;
  /** Seats (Team) or 1 on the session. */
  quantity: number;
}

/**
 * Starts a Stripe Checkout session for a subscription on the current workspace.
 * 503 BILLING_DISABLED without Stripe keys or without the price for this
 * plan and interval. 409 when the workspace already has a subscription (change
 * it in the portal) or its plan is managed by hand.
 */
export async function createCheckoutSession(actor: BillingActor, input: CheckoutInput): Promise<CheckoutResult> {
  assertCan(actor, 'workspace:billing');
  const runtime = requireBilling();
  const { workspace } = actor;

  const priceId = priceIdFor(runtime.config.prices, input.plan, input.interval);
  if (!priceId) {
    throw billingDisabledError({ reason: 'price_not_configured', plan: input.plan, interval: input.interval });
  }

  const blocked = checkoutBlock(workspace);
  if (blocked === 'plan_managed_manually') {
    throw new ApiError(409, "This workspace's plan is managed by an administrator", 'PLAN_MANAGED_MANUALLY');
  }
  if (blocked === 'already_subscribed') {
    throw new ApiError(409, 'This workspace already has a subscription; change it in the billing portal', 'ALREADY_SUBSCRIBED');
  }

  const members = await countActiveMembers(workspace._id);
  const perSeat = PER_SEAT_PLANS.has(input.plan);
  // Every active member needs a seat; the buyer may add more (also adjustable on Stripe's page).
  const quantity = perSeat ? Math.min(MAX_SEATS, Math.max(1, members, input.seats ?? 1)) : 1;

  const customerId = await ensureCustomer(runtime, actor);
  const workspaceId = String(workspace._id);
  const returnBase = `${env.FRONTEND_URL}/settings/billing`;

  let session: Stripe.Checkout.Session;
  try {
    session = await runtime.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: workspaceId,
        line_items: [
          {
            price: priceId,
            quantity,
            ...(perSeat ? { adjustable_quantity: { enabled: true, minimum: Math.max(1, members), maximum: MAX_SEATS } } : {}),
          },
        ],
        subscription_data: { metadata: { workspaceId, plan: input.plan } },
        metadata: { workspaceId, plan: input.plan, interval: input.interval },
        success_url: `${returnBase}?checkout=success`,
        cancel_url: `${returnBase}?checkout=canceled`,
        allow_promotion_codes: true,
        ...(runtime.automaticTax
          ? {
              automatic_tax: { enabled: true },
              billing_address_collection: 'required' as const,
              tax_id_collection: { enabled: true },
              customer_update: { address: 'auto' as const, name: 'auto' as const },
            }
          : {}),
      },
      // A double click reuses the open session instead of creating a second one.
      { idempotencyKey: `openpoll-checkout-${workspaceId}-${priceId}-${quantity}-${Math.floor(Date.now() / 300_000)}` },
    );
  } catch (error) {
    throw providerError('checkout session', error);
  }
  if (!session.url) throw providerError('checkout session', new Error('the session has no url'));

  return { url: session.url, sessionId: session.id, quantity };
}

/** Opens the Stripe Billing Portal (payment method, invoices, plan changes, cancellation). */
export async function createPortalSession(actor: BillingActor): Promise<{ url: string }> {
  assertCan(actor, 'workspace:billing');
  const runtime = requireBilling();
  const { workspace } = actor;

  const customerId = workspace.billing?.stripeCustomerId;
  if (!customerId) {
    throw new ApiError(409, 'This workspace has no billing account yet; subscribe to a plan first', 'NO_BILLING_ACCOUNT');
  }

  let session: Stripe.BillingPortal.Session;
  try {
    session = await runtime.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.FRONTEND_URL}/settings/billing`,
    });
  } catch (error) {
    throw providerError('portal session', error);
  }

  return { url: session.url };
}
