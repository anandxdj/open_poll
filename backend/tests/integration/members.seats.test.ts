import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import mongoose from 'mongoose';
import { setBillingRuntime } from '../../src/modules/billing/stripe';
import { WorkspaceModel } from '../../src/modules/workspaces/workspace.model';
import { WorkspaceMemberModel } from '../../src/modules/workspaces/workspaceMember.model';
import { PRICES, billingRuntime, stripeDouble, subscriptionFixture, type StripeDouble } from '../fixtures/stripe';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Members and the Stripe seat sync (W3-B1 x W3-C): a membership that is created
 * (invite accepted) or reactivated makes sure a per-seat subscription covers the
 * members. The seat limit itself is pinned by an override so that the members can
 * outgrow the recorded quantity, as they do when SCIM or SSO adds people.
 */
describeIntegration('members: seat sync after a membership change', () => {
  let server: TestServer;
  let double: StripeDouble;
  let owner: TestUser;
  let invitee: TestUser;
  let wsId: string;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  afterAll(async () => {
    setBillingRuntime(null);
    await server?.close();
  });

  const call = async (user: TestUser, method: string, path: string, body?: unknown) => {
    const res = await server.request(path, { method, headers: { ...user.headers }, body });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  /** Lets the fire-and-forget sync finish. */
  const settle = async (done: () => boolean) => {
    for (let attempt = 0; attempt < 50 && !done(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  };

  beforeEach(async () => {
    await resetTestData();
    owner = await createVerifiedUser({ name: 'Olivia' });
    invitee = await createVerifiedUser({ name: 'Ivan' });
    const created = await call(owner, 'POST', '/api/workspaces', { name: 'Acme' });
    wsId = created.body.data.workspace._id;
    await WorkspaceModel.updateOne(
      { _id: wsId },
      {
        $set: {
          plan: 'team',
          planSource: 'stripe',
          planOverrides: { limits: { seats: 10 } },
          billing: { stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active', priceId: PRICES.teamMonthly, seats: 1 },
        },
      },
    );
    double = stripeDouble();
    const subscription = subscriptionFixture({ workspaceId: wsId, price: PRICES.teamMonthly, quantity: 1 });
    double.subscriptions.set(subscription.id, subscription);
  });

  it('raises the subscription when an accepted invite adds a member beyond the purchased seats', async () => {
    setBillingRuntime(billingRuntime(double));
    const invited = await call(owner, 'POST', `/api/workspaces/${wsId}/invites`, { email: invitee.email, role: 'editor' });
    expect(invited.status).toBe(201);
    const token = String(invited.body.data.inviteUrl).split('/invites/')[1]!;

    const accepted = await call(invitee, 'POST', `/api/invites/${token}/accept`);
    expect(accepted.status).toBe(200);

    await settle(() => double.calls.subscriptionsUpdate.length > 0);
    expect(double.calls.subscriptionsUpdate).toEqual([
      { id: 'sub_1', params: { items: [{ id: 'si_1', quantity: 2 }], proration_behavior: 'create_prorations' } },
    ]);
    await settle(() => false); // the follow-up subscription sync records the new quantity
    expect((await WorkspaceModel.findById(wsId).lean())?.billing?.seats).toBe(2);
  });

  it('raises the subscription when a suspended member is reactivated', async () => {
    await WorkspaceMemberModel.create({ workspaceId: wsId, userId: invitee.id, role: 'editor', status: 'suspended' });
    setBillingRuntime(billingRuntime(double));

    const res = await call(owner, 'PATCH', `/api/workspaces/${wsId}/members/${invitee.id}`, { status: 'active' });
    expect(res.status).toBe(200);

    await settle(() => double.calls.subscriptionsUpdate.length > 0);
    expect(double.calls.subscriptionsUpdate).toHaveLength(1);
    expect(double.calls.subscriptionsUpdate[0].params.items[0].quantity).toBe(2);
  });

  it('does nothing without Stripe, and a role change takes no seat', async () => {
    setBillingRuntime(null);
    const member = await WorkspaceMemberModel.create({ workspaceId: wsId, userId: invitee.id, role: 'viewer', status: 'active' });
    const invited = await createVerifiedUser({ name: 'Zed' });
    const mail = await call(owner, 'POST', `/api/workspaces/${wsId}/invites`, { email: invited.email, role: 'viewer' });
    const token = String(mail.body.data.inviteUrl).split('/invites/')[1]!;
    const accepted = await call(invited, 'POST', `/api/invites/${token}/accept`);
    expect(accepted.status).toBe(200);
    expect(double.calls.subscriptionsUpdate).toHaveLength(0);

    setBillingRuntime(billingRuntime(double));
    const res = await call(owner, 'PATCH', `/api/workspaces/${wsId}/members/${member.userId}`, { role: 'editor' });
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(double.calls.subscriptionsUpdate).toHaveLength(0);
  });

  it('logs and survives a failing Stripe call', async () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      double.fail.retrieve = new Error('stripe is down');
      setBillingRuntime(billingRuntime(double));
      await WorkspaceMemberModel.create({ workspaceId: wsId, userId: invitee.id, role: 'editor', status: 'suspended' });
      const res = await call(owner, 'PATCH', `/api/workspaces/${wsId}/members/${invitee.id}`, { status: 'active' });
      expect(res.status).toBe(200);
      await settle(() => consoleError.mock.calls.length > 0);
      expect(String(consoleError.mock.calls[0]?.[0])).toContain('Seat sync after a membership change failed');
    } finally {
      consoleError.mockRestore();
    }
  });
});
