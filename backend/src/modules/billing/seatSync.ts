import { audit } from '../../common/audit/audit';
import { registerJob, type JobContext } from '../../common/jobs/scheduler';
import { WorkspaceModel, type IWorkspace } from '../workspaces/workspace.model';
import { WorkspaceMemberModel } from '../workspaces/workspaceMember.model';
import { MAX_SEATS } from './billing.schema';
import { PER_SEAT_PLANS } from './prices';
import { getBillingRuntime, type BillingRuntime } from './stripe';
import { isEntitledStatus, snapshotFromSubscription } from './subscriptionState';
import { syncSubscription } from './subscriptionSync';

/**
 * Seat sync (per-seat plans: Team). Seats are purchased capacity: the owner
 * buys them at checkout and changes them in the Billing Portal, and the
 * webhook records the quantity as `billing.seats`, which is the plan's seat
 * limit. This job covers the one gap: members who joined without going through
 * the seat check (SCIM, SSO just-in-time, a lowered quantity) must be paid
 * for, so when active members exceed the subscription's quantity it raises the
 * quantity to the member count (prorated by Stripe). It never lowers it:
 * unused seats are capacity the owner chose and removes in the portal.
 * No-op when billing is not configured.
 */

export const SEAT_SYNC_JOB = 'billing-seat-sync';
export const SEAT_SYNC_EVERY_MS = 15 * 60_000;
const BATCH = 200;

export type SeatSyncOutcome =
  | { outcome: 'skipped'; reason: 'not_per_seat' | 'not_stripe_managed' | 'not_entitled' | 'subscription_missing' }
  | { outcome: 'unchanged'; seats: number; members: number }
  | { outcome: 'raised'; from: number; to: number };

type SeatWorkspace = Pick<IWorkspace, '_id' | 'plan' | 'planSource' | 'billing' | 'planOverrides'>;

/** Raises the subscription's seats to the active members when it covers fewer. */
export async function syncWorkspaceSeats(runtime: BillingRuntime, workspace: SeatWorkspace): Promise<SeatSyncOutcome> {
  if (!PER_SEAT_PLANS.has(workspace.plan as 'team')) return { outcome: 'skipped', reason: 'not_per_seat' };
  if (workspace.planSource !== 'stripe') return { outcome: 'skipped', reason: 'not_stripe_managed' };
  const subscriptionId = workspace.billing?.stripeSubscriptionId;
  if (!subscriptionId) return { outcome: 'skipped', reason: 'subscription_missing' };
  if (!isEntitledStatus(workspace.billing?.status)) return { outcome: 'skipped', reason: 'not_entitled' };

  const members = Math.min(MAX_SEATS, await WorkspaceMemberModel.countDocuments({ workspaceId: workspace._id, status: 'active' }));
  const recorded = workspace.billing?.seats ?? 0;
  if (members <= recorded) return { outcome: 'unchanged', seats: recorded, members };

  // The stored quantity may be stale: read the subscription before changing it.
  const subscription = await runtime.stripe.subscriptions.retrieve(subscriptionId);
  const snapshot = snapshotFromSubscription(subscription, runtime.config.prices);
  const current = snapshot.quantity ?? 0;
  if (!snapshot.itemId || !isEntitledStatus(snapshot.status)) return { outcome: 'skipped', reason: 'not_entitled' };

  if (members <= current) {
    await syncSubscription(runtime, subscriptionId);
    return { outcome: 'unchanged', seats: current, members };
  }

  await runtime.stripe.subscriptions.update(
    subscriptionId,
    { items: [{ id: snapshot.itemId, quantity: members }], proration_behavior: 'create_prorations' },
    { idempotencyKey: `openpoll-seats-${subscriptionId}-${current}-${members}` },
  );
  await syncSubscription(runtime, subscriptionId);
  void audit(
    { actorType: 'system', workspace: { _id: workspace._id, plan: workspace.plan, planOverrides: workspace.planOverrides } },
    'billing.seats.raise',
    { type: 'workspace', id: workspace._id },
    { from: current, to: members, subscriptionId },
  );
  return { outcome: 'raised', from: current, to: members };
}

/**
 * After a membership was created or reactivated (invite accepted, member reactivated): checks the
 * subscription covers the members without delaying the request. No-op without Stripe; a failure is
 * logged and left to the periodic job.
 */
export function syncSeatsAfterMembershipChange(workspace: SeatWorkspace): void {
  const runtime = getBillingRuntime();
  if (!runtime) return;
  void syncWorkspaceSeats(runtime, workspace).catch((error) => {
    console.error('[Billing] Seat sync after a membership change failed:', error);
  });
}

/** One pass over every Stripe-managed Team workspace; one workspace's failure never stops the rest. */
export async function runSeatSync(runtime: BillingRuntime, signal?: AbortSignal): Promise<{ checked: number; raised: number; failed: number }> {
  const totals = { checked: 0, raised: 0, failed: 0 };
  const filter: Record<string, unknown> = {
    deletedAt: null,
    plan: { $in: [...PER_SEAT_PLANS] },
    planSource: 'stripe',
    'billing.stripeSubscriptionId': { $type: 'string' },
  };

  let after: IWorkspace['_id'] | null = null;
  for (;;) {
    if (signal?.aborted) break;
    const batch: IWorkspace[] = await WorkspaceModel.find(after ? { ...filter, _id: { $gt: after } } : filter)
      .sort({ _id: 1 })
      .limit(BATCH)
      .select('plan planSource planOverrides billing');
    if (batch.length === 0) break;
    for (const workspace of batch) {
      if (signal?.aborted) return totals;
      totals.checked += 1;
      try {
        const result = await syncWorkspaceSeats(runtime, workspace);
        if (result.outcome === 'raised') totals.raised += 1;
      } catch (error) {
        totals.failed += 1;
        console.error(`[Billing] Seat sync failed for workspace ${String(workspace._id)}:`, (error as Error)?.message);
      }
    }
    after = batch[batch.length - 1]!._id;
  }
  return totals;
}

registerJob({
  name: SEAT_SYNC_JOB,
  everyMs: SEAT_SYNC_EVERY_MS,
  run: async ({ signal }: JobContext) => {
    const runtime = getBillingRuntime();
    if (!runtime) return;
    const totals = await runSeatSync(runtime, signal);
    if (totals.raised > 0 || totals.failed > 0) console.log(`[Billing] Seat sync: ${JSON.stringify(totals)}`);
  },
});
