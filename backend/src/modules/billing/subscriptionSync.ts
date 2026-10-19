import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { audit } from '../../common/audit/audit';
import { redisClient } from '../../common/config/redis';
import type { PlanId } from '../../common/plans/plans';
import { WorkspaceModel, type IWorkspace } from '../workspaces/workspace.model';
import type { BillingRuntime } from './stripe';
import { decideSubscriptionUpdate, snapshotFromSubscription, type SubscriptionSnapshot } from './subscriptionState';

/**
 * Applies a subscription's *current* state to its workspace. Webhook events
 * can arrive late, twice or out of order, so the handler never trusts the
 * event's copy: it retrieves the subscription from Stripe and applies that,
 * under a per-subscription lock so two deliveries cannot interleave a stale
 * read with a newer write.
 */

export type SyncResult =
  | { outcome: 'ignored'; reason: string; subscriptionId: string }
  | {
      outcome: 'applied';
      subscriptionId: string;
      workspaceId: string;
      status: string;
      plan: PlanId;
      previousPlan: PlanId;
      managedManually: boolean;
    };

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 100;
const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

export const subscriptionLockKey = (subscriptionId: string) => `billing:{${subscriptionId}}:lock`;

class SubscriptionBusyError extends Error {
  constructor(subscriptionId: string) {
    super(`Subscription ${subscriptionId} is being synced by another request`);
    this.name = 'SubscriptionBusyError';
  }
}

/** Runs `fn` holding the subscription's lock; proceeds unlocked (logged) while Redis is down. */
async function withSubscriptionLock<T>(subscriptionId: string, fn: () => Promise<T>): Promise<T> {
  const key = subscriptionLockKey(subscriptionId);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  let locked = false;
  try {
    for (;;) {
      const reply = await redisClient.set(key, token, { condition: 'NX', expiration: { type: 'PX', value: LOCK_TTL_MS } });
      if (reply === 'OK') {
        locked = true;
        break;
      }
      if (Date.now() >= deadline) throw new SubscriptionBusyError(subscriptionId);
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  } catch (error) {
    if (error instanceof SubscriptionBusyError) throw error;
    console.error('[Billing] Redis unavailable, syncing the subscription without a lock:', (error as Error)?.message);
  }
  try {
    return await fn();
  } finally {
    if (locked) {
      await redisClient
        .eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] })
        .catch((error: unknown) => console.error('[Billing] Failed to release a subscription lock:', (error as Error)?.message));
    }
  }
}

const isMissing = (error: unknown) => {
  const e = error as { code?: string; statusCode?: number } | null;
  return e?.code === 'resource_missing' || e?.statusCode === 404;
};

/**
 * The workspace a subscription belongs to: the one holding its customer, else
 * the workspace named by checkout (`hint`) or the subscription metadata, as
 * long as that workspace has no other Stripe customer.
 */
async function findWorkspace(snapshot: SubscriptionSnapshot, hint?: string | null): Promise<IWorkspace | null> {
  if (snapshot.customerId) {
    const byCustomer = await WorkspaceModel.findOne({ 'billing.stripeCustomerId': snapshot.customerId });
    if (byCustomer) return byCustomer;
  }
  for (const id of [hint, snapshot.workspaceId]) {
    if (!id || !OBJECT_ID.test(id)) continue;
    const workspace = await WorkspaceModel.findById(id);
    if (!workspace) continue;
    const customer = workspace.billing?.stripeCustomerId ?? null;
    if (!customer || customer === snapshot.customerId) return workspace;
    console.warn(
      `[Billing] Subscription ${snapshot.id} names workspace ${id}, which belongs to another Stripe customer; ignored`,
    );
  }
  return null;
}

export async function syncSubscription(
  runtime: BillingRuntime,
  subscriptionId: string,
  options: { fallback?: Stripe.Subscription | null; workspaceIdHint?: string | null } = {},
): Promise<SyncResult> {
  return withSubscriptionLock(subscriptionId, async () => {
    let subscription: Stripe.Subscription;
    try {
      subscription = await runtime.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (!options.fallback) return { outcome: 'ignored', reason: 'subscription_not_found', subscriptionId };
      subscription = options.fallback;
    }

    const prices = runtime.config.prices;
    const snapshot = snapshotFromSubscription(subscription, prices);
    const workspace = await findWorkspace(snapshot, options.workspaceIdHint);
    if (!workspace) {
      console.warn(`[Billing] No workspace for subscription ${subscriptionId} (customer ${snapshot.customerId}); ignored`);
      return { outcome: 'ignored', reason: 'workspace_not_found', subscriptionId };
    }

    const decision = decideSubscriptionUpdate(workspace, snapshot, prices);
    if (!decision.apply) return { outcome: 'ignored', reason: decision.reason, subscriptionId };
    if (decision.unknownPrice) {
      console.error(
        `[Billing] Subscription ${subscriptionId} uses price ${snapshot.priceId}, which no STRIPE_PRICE_* names; plan left unchanged`,
      );
    }

    let { plan, managedManually } = decision;
    const previousStatus = workspace.billing?.stripeSubscriptionId === subscriptionId ? (workspace.billing.status ?? null) : null;
    const changesPlan = 'plan' in decision.set;
    // Never overwrite a manual plan, including one set between the read above and this write.
    const result = await WorkspaceModel.updateOne(
      changesPlan ? { _id: workspace._id, planSource: { $ne: 'manual' } } : { _id: workspace._id },
      { $set: decision.set },
    );
    if (changesPlan && result.matchedCount === 0) {
      const billingOnly = Object.fromEntries(
        Object.entries(decision.set).filter(([key]) => key.startsWith('billing.') && key !== 'billing.seats'),
      );
      await WorkspaceModel.updateOne({ _id: workspace._id }, { $set: billingOnly });
      plan = decision.previousPlan;
      managedManually = true;
    }

    const actor = {
      actorType: 'system' as const,
      workspace: { _id: workspace._id, plan, planOverrides: workspace.planOverrides },
    };
    const target = { type: 'workspace', id: workspace._id };
    if (plan !== decision.previousPlan) {
      void audit(actor, 'billing.plan.change', target, {
        from: decision.previousPlan,
        to: plan,
        status: snapshot.status,
        subscriptionId,
      });
    }
    if (previousStatus !== snapshot.status) {
      void audit(actor, 'billing.subscription.update', target, { from: previousStatus, to: snapshot.status, subscriptionId });
    }
    if (decision.replacedSubscriptionId) {
      console.error(
        `[Billing] Workspace ${String(workspace._id)} now follows subscription ${subscriptionId} while ` +
          `${decision.replacedSubscriptionId} may still be billing; cancel the extra one in Stripe`,
      );
      void audit(actor, 'billing.subscription.replaced', target, {
        subscriptionId,
        replacedSubscriptionId: decision.replacedSubscriptionId,
      });
    }

    return {
      outcome: 'applied',
      subscriptionId,
      workspaceId: String(workspace._id),
      status: snapshot.status,
      plan,
      previousPlan: decision.previousPlan,
      managedManually,
    };
  });
}
