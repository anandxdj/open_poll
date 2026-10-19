import { z } from 'zod';
import { BILLING_INTERVALS, PAID_PLAN_IDS } from './prices';

/** The most seats one Team checkout or seat change may ask for. */
export const MAX_SEATS = 1000;

/**
 * POST /api/billing/checkout. The client picks what to buy; everything else
 * (workspace, customer, prices, URLs) is decided server-side. `seats` only
 * matters for per-seat plans (Team) and never goes below the active members.
 */
export const checkoutSchema = z.strictObject({
  plan: z.enum(PAID_PLAN_IDS),
  interval: z.enum(BILLING_INTERVALS),
  seats: z.number().int().min(1).max(MAX_SEATS).optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
