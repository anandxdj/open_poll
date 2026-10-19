import type { PlanFeature } from "@/features/workspaces/types";
import { formatLimit, perMonth, yearlySavingsPercent } from "./format";
import type { BillingInterval, CatalogPlan, PlanCatalog, PlanPrice } from "../types";

const NO_FEATURES: Record<PlanFeature, boolean> = {
  export_csv: false,
  export_xlsx: false,
  export_pdf: false,
  brand_kits: false,
  sso: false,
  scim: false,
  custom_domains: false,
  white_label: false,
};
const PAID_FEATURES: Record<PlanFeature, boolean> = {
  ...NO_FEATURES,
  export_csv: true,
  export_xlsx: true,
  export_pdf: true,
  brand_kits: true,
};
const NO_CHECKOUT = { monthly: false, yearly: false };

/**
 * What the landing pricing shows when GET /api/plans cannot be reached. It
 * mirrors the defaults in backend/src/common/plans/plans.ts (limits and
 * features only: a price is never invented, so none is listed). Keep the two
 * in step when the backend numbers change.
 */
export const FALLBACK_CATALOG: PlanCatalog = {
  billingEnabled: false,
  plans: [
    {
      id: "free",
      name: "Free",
      limits: { audienceCap: 100, seats: 1, retentionDays: 365, auditRetentionDays: 30, aiDecksPerMonth: 5, importsPerMonth: 5 },
      features: { ...NO_FEATURES, export_csv: true },
      perSeat: false,
      prices: null,
      checkout: NO_CHECKOUT,
    },
    {
      id: "pro",
      name: "Pro",
      limits: { audienceCap: 1_000, seats: 1, retentionDays: 730, auditRetentionDays: 90, aiDecksPerMonth: 50, importsPerMonth: 50 },
      features: PAID_FEATURES,
      perSeat: false,
      prices: null,
      checkout: NO_CHECKOUT,
    },
    {
      id: "team",
      name: "Team",
      limits: { audienceCap: 2_000, seats: 5, retentionDays: 1_095, auditRetentionDays: 365, aiDecksPerMonth: 200, importsPerMonth: 200 },
      features: PAID_FEATURES,
      perSeat: true,
      prices: null,
      checkout: NO_CHECKOUT,
    },
    {
      id: "enterprise",
      name: "Enterprise",
      limits: { audienceCap: 10_000, seats: null, retentionDays: null, auditRetentionDays: 730, aiDecksPerMonth: null, importsPerMonth: null },
      features: {
        export_csv: true,
        export_xlsx: true,
        export_pdf: true,
        brand_kits: true,
        sso: true,
        scim: true,
        custom_domains: true,
        white_label: true,
      },
      perSeat: false,
      prices: null,
      checkout: NO_CHECKOUT,
    },
  ],
};

/** The plan's selling points, every one read from its limits and features. */
export function planHighlights(plan: CatalogPlan): string[] {
  const { limits, features } = plan;
  const lines: string[] = [];

  lines.push(`Up to ${formatLimit(limits.audienceCap)} participants per live session or poll`);
  if (plan.perSeat) lines.push("Priced per member, with shared decks and roles");
  else if (limits.seats === null) lines.push("Unlimited members");
  else lines.push(limits.seats === 1 ? "1 member" : `${formatLimit(limits.seats)} members`);
  lines.push(
    limits.aiDecksPerMonth === null
      ? "Unlimited AI-generated decks"
      : `${formatLimit(limits.aiDecksPerMonth)} AI-generated decks per month`,
  );
  lines.push(
    limits.importsPerMonth === null ? "Unlimited imports" : `${formatLimit(limits.importsPerMonth)} imports per month`,
  );
  lines.push(features.export_xlsx || features.export_pdf ? "CSV, Excel and PDF export" : "CSV export");
  if (features.brand_kits) lines.push("Brand kits");
  if (features.sso || features.scim) lines.push("Single sign-on and SCIM provisioning");
  if (features.custom_domains || features.white_label) lines.push("Custom domains and white label");
  lines.push(
    limits.retentionDays === null
      ? "Keep session data as long as you need"
      : `Keep session data up to ${formatLimit(limits.retentionDays)} days`,
  );
  return lines;
}

export type TierPrice =
  | { kind: "free" }
  /** No published price: Enterprise, or a plan this server has no Stripe price for. */
  | { kind: "custom" }
  | { kind: "priced"; amount: PlanPrice; billedAs: PlanPrice | null };

export interface PricingTier {
  plan: CatalogPlan;
  price: TierPrice;
  highlights: string[];
  mostPopular: boolean;
}

/** One tier per plan for the interval the visitor picked; falls back to monthly when a plan has no yearly price. */
export function pricingTiers(catalog: PlanCatalog, interval: BillingInterval): PricingTier[] {
  return catalog.plans.map((plan) => {
    let price: TierPrice = { kind: "custom" };
    if (plan.id === "free") price = { kind: "free" };
    else if (plan.prices) {
      const chosen = interval === "yearly" && plan.prices.yearly ? "yearly" : "monthly";
      const picked = plan.prices[chosen];
      if (picked) {
        price = {
          kind: "priced",
          amount: perMonth(picked, chosen),
          // A yearly price is charged once a year: say so.
          billedAs: chosen === "yearly" ? picked : null,
        };
      }
    }
    return { plan, price, highlights: planHighlights(plan), mostPopular: plan.id === "pro" };
  });
}

/** Whether any plan has both a monthly and a yearly price, i.e. whether the toggle means something. */
export function hasIntervalChoice(catalog: PlanCatalog): boolean {
  return catalog.plans.some((plan) => plan.prices?.monthly && plan.prices.yearly);
}

/** The best yearly saving across the plans, for the toggle's badge. */
export function bestYearlySavings(catalog: PlanCatalog): number | null {
  const savings = catalog.plans
    .map((plan) => yearlySavingsPercent(plan.prices?.monthly ?? null, plan.prices?.yearly ?? null))
    .filter((value): value is number => value !== null);
  return savings.length ? Math.max(...savings) : null;
}
