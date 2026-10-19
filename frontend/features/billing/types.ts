/**
 * Shapes of the billing API (backend/docs/wiki/modules/billing.md): the public
 * plan catalogue (GET /api/plans) and the current workspace's billing
 * overview (GET /api/billing).
 */
import type { Entitlements, PlanFeature, PlanId, PlanLimit, WorkspaceType } from "@/features/workspaces/types";

export type PaidPlanId = "pro" | "team";
export type BillingInterval = "monthly" | "yearly";

export interface PlanPrice {
  /** Minor units of one billing period (a year for the yearly price). */
  amount: number;
  /** Lower-case ISO 4217 code. */
  currency: string;
}

export interface CatalogPlan {
  id: PlanId;
  name: string;
  /** null = unlimited. */
  limits: Record<PlanLimit, number | null>;
  features: Record<PlanFeature, boolean>;
  /** The price is per seat (Team). */
  perSeat: boolean;
  /** null when no price is configured (Free, Enterprise, or billing off). */
  prices: Record<BillingInterval, PlanPrice | null> | null;
  /** Whether checkout can sell the plan at each interval. */
  checkout: Record<BillingInterval, boolean>;
}

export interface PlanCatalog {
  billingEnabled: boolean;
  plans: CatalogPlan[];
}

export interface UsageMeter {
  counter: "ai_deck" | "import";
  limitKey: PlanLimit;
  /** yyyymm, UTC. */
  period: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  remaining: number | null;
}

export type PlanSource = "default" | "stripe" | "manual";

export interface BillingOverview {
  /** Stripe billing is configured on the server. */
  enabled: boolean;
  workspace: { _id: string; name: string; type: WorkspaceType };
  plan: PlanId;
  planSource: PlanSource;
  /** Stripe subscription status, or null without a subscription. */
  status: string | null;
  subscription: { plan: PaidPlanId; interval: BillingInterval } | null;
  /** ISO date string. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentFailed: boolean;
  seats: { used: number; limit: number | null; purchased: number | null };
  usage: UsageMeter[];
  entitlements: Entitlements;
  canOpenPortal: boolean;
  checkout: Record<PaidPlanId, Record<BillingInterval, boolean>>;
  checkoutBlockedReason: "already_subscribed" | "plan_managed_manually" | null;
}

export interface CheckoutRequest {
  plan: PaidPlanId;
  interval: BillingInterval;
  /** Team only; the server never goes below the active members. */
  seats?: number;
}
