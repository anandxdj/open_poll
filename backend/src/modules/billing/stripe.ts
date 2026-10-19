import Stripe from 'stripe';
import { env, type AppEnv } from '../../common/config/env';
import { ApiError } from '../../common/utils/ApiError';

/**
 * Stripe configuration and client for the billing module. Billing is enabled
 * by STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET (env.billing); without them
 * every billing action fails with 503 BILLING_DISABLED and plans are set by
 * hand (scripts/set-plan.ts). Tests swap the runtime with setBillingRuntime().
 */

export type BillingConfig = NonNullable<AppEnv['billing']>;

/** The parts of the Stripe SDK the billing module calls (tests pass a double). */
export type StripeClient = Pick<
  Stripe,
  'billingPortal' | 'checkout' | 'customers' | 'prices' | 'subscriptions' | 'webhooks'
>;

export interface BillingRuntime {
  config: BillingConfig;
  stripe: StripeClient;
  /** STRIPE_AUTOMATIC_TAX=true: Stripe Tax on checkout (needs Stripe Tax set up in the dashboard). */
  automaticTax: boolean;
}

export function createBillingRuntime(
  config: AppEnv['billing'] = env.billing,
  source: Record<string, string | undefined> = process.env,
): BillingRuntime | null {
  if (!config) return null;
  return {
    config,
    stripe: new Stripe(config.secretKey, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: 'OpenPoll' },
    }),
    automaticTax: source.STRIPE_AUTOMATIC_TAX?.trim().toLowerCase() === 'true',
  };
}

let runtime: BillingRuntime | null | undefined;

/** null when Stripe billing is not configured. */
export function getBillingRuntime(): BillingRuntime | null {
  if (runtime === undefined) runtime = createBillingRuntime();
  return runtime;
}

/** Replaces the runtime (tests); returns the previous one so it can be restored. */
export function setBillingRuntime(next: BillingRuntime | null): BillingRuntime | null {
  const previous = getBillingRuntime();
  runtime = next;
  return previous;
}

export const billingDisabledError = (details?: Record<string, unknown>) =>
  new ApiError(503, 'Billing is not configured on this server', 'BILLING_DISABLED', details);

/** The runtime, or 503 BILLING_DISABLED. */
export function requireBilling(): BillingRuntime {
  const current = getBillingRuntime();
  if (!current) throw billingDisabledError();
  return current;
}

/** A Stripe id from an expandable field (string or object with `id`). */
export function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}
