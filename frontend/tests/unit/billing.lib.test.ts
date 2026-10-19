import { describe, expect, test } from "bun:test";

import {
  FALLBACK_CATALOG,
  bestYearlySavings,
  hasIntervalChoice,
  planHighlights,
  pricingTiers,
} from "@/features/billing/lib/catalog";
import { formatDate, formatLimit, formatMoney, perMonth, usagePercent, yearlySavingsPercent } from "@/features/billing/lib/format";
import { isProblemStatus, planStatusKey } from "@/features/billing/lib/status";
import type { CatalogPlan, PlanCatalog } from "@/features/billing/types";

const priced = (catalog: PlanCatalog): PlanCatalog => ({
  billingEnabled: true,
  plans: catalog.plans.map((plan): CatalogPlan => {
    if (plan.id === "pro") {
      return { ...plan, prices: { monthly: { amount: 1500, currency: "usd" }, yearly: { amount: 14400, currency: "usd" } }, checkout: { monthly: true, yearly: true } };
    }
    if (plan.id === "team") {
      return { ...plan, prices: { monthly: { amount: 1200, currency: "usd" }, yearly: { amount: 11400, currency: "usd" } }, checkout: { monthly: true, yearly: true } };
    }
    return plan;
  }),
});

describe("formatMoney", () => {
  test("shows whole amounts without decimals and keeps cents", () => {
    expect(formatMoney(1500, "usd")).toBe("$15");
    expect(formatMoney(1250, "usd")).toBe("$12.50");
    expect(formatMoney(0, "usd")).toBe("$0");
    expect(formatMoney(1999, "eur")).toBe("€19.99");
  });

  test("knows currencies with no minor unit", () => {
    expect(formatMoney(1500, "jpy")).toBe("¥1,500");
  });

  test("never throws on a currency it does not know", () => {
    expect(formatMoney(500, "zzzz")).toContain("5");
  });
});

describe("price helpers", () => {
  test("spreads a yearly price over twelve months", () => {
    expect(perMonth({ amount: 14400, currency: "usd" }, "yearly")).toEqual({ amount: 1200, currency: "usd" });
    expect(perMonth({ amount: 1500, currency: "usd" }, "monthly")).toEqual({ amount: 1500, currency: "usd" });
  });

  test("computes the real yearly saving, or none", () => {
    expect(yearlySavingsPercent({ amount: 1500, currency: "usd" }, { amount: 14400, currency: "usd" })).toBe(20);
    expect(yearlySavingsPercent({ amount: 1500, currency: "usd" }, { amount: 18000, currency: "usd" })).toBeNull();
    expect(yearlySavingsPercent({ amount: 1500, currency: "usd" }, { amount: 14400, currency: "eur" })).toBeNull();
    expect(yearlySavingsPercent(null, { amount: 14400, currency: "usd" })).toBeNull();
  });

  test("limits and usage read as numbers, unlimited and percentages", () => {
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(10_000)).toBe("10,000");
    expect(usagePercent(3, 5)).toBe(60);
    expect(usagePercent(9, 5)).toBe(100);
    expect(usagePercent(4, null)).toBe(0);
    expect(usagePercent(0, 0)).toBe(0);
    expect(usagePercent(1, 0)).toBe(100);
  });

  test("dates are UTC and tolerate garbage", () => {
    expect(formatDate("2026-11-19T23:30:00.000Z")).toBe("Nov 19, 2026");
    expect(formatDate("not a date")).toBe("");
  });
});

describe("plan status", () => {
  test("a plan assigned by hand ignores Stripe", () => {
    expect(planStatusKey({ planSource: "manual", status: "canceled" })).toBe("manual");
  });

  test("maps Stripe statuses to the status line", () => {
    expect(planStatusKey({ planSource: "default", status: null })).toBe("free");
    expect(planStatusKey({ planSource: "stripe", status: "active" })).toBe("active");
    expect(planStatusKey({ planSource: "stripe", status: "past_due" })).toBe("pastDue");
    expect(planStatusKey({ planSource: "default", status: "canceled" })).toBe("canceled");
    expect(planStatusKey({ planSource: "default", status: "incomplete_expired" })).toBe("canceled");
    expect(planStatusKey({ planSource: "stripe", status: "something_new" })).toBe("incomplete");
  });

  test("payment problems are flagged", () => {
    expect(isProblemStatus("pastDue")).toBe(true);
    expect(isProblemStatus("unpaid")).toBe(true);
    expect(isProblemStatus("active")).toBe(false);
  });
});

describe("fallback catalogue", () => {
  test("lists the four plans with no price and no checkout", () => {
    expect(FALLBACK_CATALOG.plans.map((plan) => plan.id)).toEqual(["free", "pro", "team", "enterprise"]);
    for (const plan of FALLBACK_CATALOG.plans) {
      expect(plan.prices).toBeNull();
      expect(plan.checkout).toEqual({ monthly: false, yearly: false });
    }
    expect(FALLBACK_CATALOG.billingEnabled).toBe(false);
  });

  test("matches the backend plan defaults the owner confirmed", () => {
    const byId = Object.fromEntries(FALLBACK_CATALOG.plans.map((plan) => [plan.id, plan]));
    expect(byId.free!.limits).toEqual({ audienceCap: 100, seats: 1, retentionDays: 365, auditRetentionDays: 30, aiDecksPerMonth: 5, importsPerMonth: 5 });
    expect(byId.pro!.limits.audienceCap).toBe(1_000);
    expect(byId.team!.limits.audienceCap).toBe(2_000);
    expect(byId.enterprise!.limits.seats).toBeNull();
    expect(byId.free!.features.export_pdf).toBe(false);
    expect(byId.pro!.features.export_pdf).toBe(true);
    expect(byId.enterprise!.features.sso).toBe(true);
  });
});

describe("pricing tiers", () => {
  test("describes each plan from its own limits and features", () => {
    const lines = Object.fromEntries(FALLBACK_CATALOG.plans.map((plan) => [plan.id, planHighlights(plan)]));
    expect(lines.free).toContain("Up to 100 participants per live session or poll");
    expect(lines.free).toContain("1 member");
    expect(lines.free).toContain("CSV export");
    expect(lines.free).not.toContain("Brand kits");
    expect(lines.pro).toContain("50 AI-generated decks per month");
    expect(lines.pro).toContain("CSV, Excel and PDF export");
    expect(lines.pro).toContain("Brand kits");
    expect(lines.team).toContain("Priced per member, with shared decks and roles");
    expect(lines.enterprise).toContain("Unlimited members");
    expect(lines.enterprise).toContain("Unlimited AI-generated decks");
    expect(lines.enterprise).toContain("Single sign-on and SCIM provisioning");
    expect(lines.enterprise).toContain("Custom domains and white label");
  });

  test("without billing, paid plans have no price and nothing to toggle", () => {
    const tiers = pricingTiers(FALLBACK_CATALOG, "monthly");
    expect(tiers.map((tier) => tier.price.kind)).toEqual(["free", "custom", "custom", "custom"]);
    expect(hasIntervalChoice(FALLBACK_CATALOG)).toBe(false);
    expect(bestYearlySavings(FALLBACK_CATALOG)).toBeNull();
    expect(tiers.find((tier) => tier.mostPopular)?.plan.id).toBe("pro");
  });

  test("shows the price from the API, per month, with the yearly charge when yearly is picked", () => {
    const catalog = priced(FALLBACK_CATALOG);
    const monthly = pricingTiers(catalog, "monthly");
    expect(monthly[1]!.price).toEqual({ kind: "priced", amount: { amount: 1500, currency: "usd" }, billedAs: null });
    const yearly = pricingTiers(catalog, "yearly");
    expect(yearly[1]!.price).toEqual({ kind: "priced", amount: { amount: 1200, currency: "usd" }, billedAs: { amount: 14400, currency: "usd" } });
    expect(yearly[2]!.price).toMatchObject({ kind: "priced", amount: { amount: 950 } });
    expect(yearly[0]!.price.kind).toBe("free");
    expect(yearly[3]!.price.kind).toBe("custom");
    expect(hasIntervalChoice(catalog)).toBe(true);
    expect(bestYearlySavings(catalog)).toBe(21);
  });

  test("a plan without a yearly price stays on its monthly one", () => {
    const catalog = priced(FALLBACK_CATALOG);
    const pro = catalog.plans.find((plan) => plan.id === "pro")!;
    pro.prices = { monthly: pro.prices!.monthly, yearly: null };
    const tier = pricingTiers(catalog, "yearly")[1]!;
    expect(tier.price).toEqual({ kind: "priced", amount: { amount: 1500, currency: "usd" }, billedAs: null });
  });
});
