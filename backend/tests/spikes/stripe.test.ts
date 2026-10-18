import { describe, expect, it } from 'bun:test';
import Stripe from 'stripe';

/**
 * W3-C spike: under Bun, `stripe` resolves its worker build (the package's
 * `bun` export condition), which signs with SubtleCrypto. Webhook verification
 * must therefore use `constructEventAsync`; the raw body arrives as the Buffer
 * that express.raw hands /api/billing/webhook.
 */
const secret = 'whsec_spike_secret';
const stripe = new Stripe('sk_test_spike_not_a_real_key');
const payload = JSON.stringify({
  id: 'evt_spike',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_spike', object: 'checkout.session' } },
});

describe('spike: stripe', () => {
  it('verifies a locally signed payload from a raw Buffer', async () => {
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    const event = await stripe.webhooks.constructEventAsync(Buffer.from(payload), header, secret);
    expect(event.id).toBe('evt_spike');
    expect(event.type).toBe('checkout.session.completed');
  });

  it('rejects a payload that does not match its signature', async () => {
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    const tampered = payload.replace('cs_test_spike', 'cs_test_other');
    await expect(stripe.webhooks.constructEventAsync(Buffer.from(tampered), header, secret)).rejects.toThrow(
      /signature/i,
    );
  });

  it('cannot verify synchronously with constructEvent', async () => {
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
    expect(() => stripe.webhooks.constructEvent(Buffer.from(payload), header, secret)).toThrow(/synchronous/);
  });

  it('rejects a signature made with another secret', async () => {
    const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'whsec_other' });
    await expect(stripe.webhooks.constructEventAsync(Buffer.from(payload), header, secret)).rejects.toThrow(
      /signature/i,
    );
  });
});
