import { ApiError } from '../utils/ApiError';
import {
  PLANS,
  isPlanId,
  planOverridesSchema,
  type Feature,
  type LimitKey,
  type Limits,
  type PlanId,
  type PlanOverrides,
} from './plans';

/** What a workspace may do: its plan's defaults with `planOverrides` applied. */
export interface Entitlements {
  plan: PlanId;
  features: Record<Feature, boolean>;
  /** null = unlimited. */
  limits: Limits;
}

/** The workspace fields entitlements depend on (a Workspace document satisfies it). */
export interface EntitlementSubject {
  _id?: unknown;
  plan?: string | null;
  planOverrides?: unknown;
  billing?: { seats?: number | null } | null;
}

function parseOverrides(subject: EntitlementSubject): PlanOverrides {
  if (subject.planOverrides == null) return {};
  const parsed = planOverridesSchema.safeParse(subject.planOverrides);
  if (parsed.success) return parsed.data;
  // Overrides are written by scripts/set-plan.ts (validated); never fail a request over a bad one.
  console.error(`[Plans] Ignoring invalid planOverrides on workspace ${String(subject._id)}:`, parsed.error.message);
  return {};
}

/**
 * Plan defaults ⊕ planOverrides. Seats follow the purchased Stripe quantity
 * (billing.seats) when there is one, unless an override pins them.
 */
export function getEntitlements(subject: EntitlementSubject): Entitlements {
  const plan: PlanId = isPlanId(subject.plan) ? subject.plan : 'free';
  const defaults = PLANS[plan];
  const overrides = parseOverrides(subject);
  const purchasedSeats = subject.billing?.seats;

  const limits: Limits = { ...defaults.limits };
  if (typeof purchasedSeats === 'number' && purchasedSeats > 0) limits.seats = purchasedSeats;
  for (const [key, value] of Object.entries(overrides.limits ?? {}) as [LimitKey, number | null | undefined][]) {
    if (value !== undefined) limits[key] = value;
  }

  const features = { ...defaults.features };
  for (const [key, value] of Object.entries(overrides.features ?? {}) as [Feature, boolean | undefined][]) {
    if (value !== undefined) features[key] = value;
  }

  return { plan, features, limits };
}

export const hasFeature = (subject: EntitlementSubject, feature: Feature): boolean =>
  getEntitlements(subject).features[feature];

/** 403 FEATURE_NOT_IN_PLAN unless the workspace's plan includes the feature. */
export function assertFeature(subject: EntitlementSubject, feature: Feature): void {
  const { plan, features } = getEntitlements(subject);
  if (features[feature]) return;
  throw new ApiError(403, 'Your plan does not include this feature', 'FEATURE_NOT_IN_PLAN', { feature, plan });
}

/**
 * Throws 403 PLAN_LIMIT_REACHED when `n` — the count the operation would
 * reach (e.g. participants after this join) — exceeds the plan's limit.
 */
export function assertLimit(subject: EntitlementSubject, key: LimitKey, n: number): void {
  const { plan, limits } = getEntitlements(subject);
  const limit = limits[key];
  if (limit === null || n <= limit) return;
  throw new ApiError(403, 'Your plan limit has been reached', 'PLAN_LIMIT_REACHED', { limit: key, max: limit, plan });
}
