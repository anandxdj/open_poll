import type { BillingOverview } from "../types";

/** Keys of `billing.plan.status.*` in messages/en/billing.json. */
export type PlanStatusKey =
  | "free"
  | "active"
  | "trialing"
  | "pastDue"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "paused"
  | "manual";

const STATUS_KEYS: Record<string, PlanStatusKey> = {
  active: "active",
  trialing: "trialing",
  past_due: "pastDue",
  canceled: "canceled",
  unpaid: "unpaid",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "paused",
};

/** The one status line a workspace's plan shows. A plan assigned by an administrator ignores Stripe. */
export function planStatusKey(overview: Pick<BillingOverview, "planSource" | "status">): PlanStatusKey {
  if (overview.planSource === "manual") return "manual";
  if (!overview.status) return "free";
  return STATUS_KEYS[overview.status] ?? "incomplete";
}

/** Whether the status deserves a warning colour. */
export const isProblemStatus = (key: PlanStatusKey) => key === "pastDue" || key === "unpaid" || key === "incomplete";
