import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BillingIntlProvider } from "@/features/billing/components/BillingIntlProvider";
import { PlanCard } from "@/features/billing/components/PlanCard";
import { UpgradePlans } from "@/features/billing/components/UpgradePlans";
import { UsageCard } from "@/features/billing/components/UsageCard";
import type { BillingOverview } from "@/features/billing/types";

const NONE = { monthly: false, yearly: false };

function overview(fields: Partial<BillingOverview> = {}): BillingOverview {
  return {
    enabled: true,
    workspace: { _id: "w1", name: "Acme", type: "team" },
    plan: "free",
    planSource: "default",
    status: null,
    subscription: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    paymentFailed: false,
    seats: { used: 1, limit: 1, purchased: null },
    usage: [
      { counter: "ai_deck", limitKey: "aiDecksPerMonth", period: "202610", used: 3, limit: 5, remaining: 2 },
      { counter: "import", limitKey: "importsPerMonth", period: "202610", used: 0, limit: null, remaining: null },
    ],
    entitlements: {
      plan: "free",
      features: { export_csv: true, export_xlsx: false, export_pdf: false, brand_kits: false, sso: false, scim: false, custom_domains: false, white_label: false },
      limits: { audienceCap: 100, seats: 1, retentionDays: 365, auditRetentionDays: 30, aiDecksPerMonth: 5, importsPerMonth: 5 },
    },
    canOpenPortal: false,
    checkout: { pro: { monthly: true, yearly: true }, team: { monthly: true, yearly: true } },
    checkoutBlockedReason: null,
    ...fields,
  };
}

const render = (node: ReactNode) => renderToStaticMarkup(<BillingIntlProvider>{node}</BillingIntlProvider>);

describe("UsageCard", () => {
  test("shows each allowance against its limit, with unlimited and the participant cap", () => {
    const html = render(<UsageCard overview={overview()} />);
    expect(html).toContain("AI-generated decks");
    expect(html).toContain("3 of 5");
    expect(html).toContain("0 (unlimited)");
    expect(html).toContain("1 of 1");
    expect(html).toContain("Participants per live session or poll");
    expect(html).toContain(">100<");
  });
});

describe("PlanCard", () => {
  test("a free workspace has no subscription and no portal button", () => {
    const html = render(<PlanCard overview={overview()} />);
    expect(html).toContain("Free plan");
    expect(html).toContain("No subscription");
    expect(html).not.toContain("Manage billing");
  });

  test("a paying workspace shows renewal, interval and the portal", () => {
    const html = render(
      <PlanCard
        overview={overview({
          plan: "pro",
          planSource: "stripe",
          status: "active",
          subscription: { plan: "pro", interval: "yearly" },
          currentPeriodEnd: "2026-11-19T00:00:00.000Z",
          canOpenPortal: true,
        })}
      />,
    );
    expect(html).toContain("Pro plan");
    expect(html).toContain("Active");
    expect(html).toContain("Billed yearly");
    expect(html).toContain("Renews on Nov 19, 2026");
    expect(html).toContain("Manage billing");
  });

  test("a scheduled cancellation and a failed payment are called out", () => {
    const html = render(
      <PlanCard
        overview={overview({
          plan: "pro",
          planSource: "stripe",
          status: "past_due",
          paymentFailed: true,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: "2026-11-19T00:00:00.000Z",
          canOpenPortal: true,
        })}
      />,
    );
    expect(html).toContain("Payment failed");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Ends on Nov 19, 2026");
  });

  test("a plan assigned by an administrator says so", () => {
    const html = render(<PlanCard overview={overview({ plan: "enterprise", planSource: "manual" })} />);
    expect(html).toContain("Managed by an administrator");
    expect(html).toContain("does not change with payments");
  });
});

describe("UpgradePlans", () => {
  test("offers Pro and Team, with seats for Team, and no invented price", () => {
    const html = render(<UpgradePlans overview={overview({ seats: { used: 3, limit: 5, purchased: null } })} />);
    expect(html).toContain('data-testid="upgrade-pro"');
    expect(html).toContain('data-testid="upgrade-team"');
    expect(html).toContain("Choose Pro");
    expect(html).toContain("Choose Team");
    expect(html).toContain("Price shown at checkout");
    expect(html).toContain("At least one per member (3 now).");
    expect(html).toContain('min="3"');
  });

  test("disables a plan whose price is not configured at the interval", () => {
    const html = render(<UpgradePlans overview={overview({ checkout: { pro: NONE, team: { monthly: true, yearly: false } } })} />);
    expect(html).toContain("Not available at this interval");
    expect(html).toContain("Choose Team");
  });

  test("explains why a subscribed or hand-managed workspace cannot buy again", () => {
    const subscribed = render(<UpgradePlans overview={overview({ checkoutBlockedReason: "already_subscribed" })} />);
    expect(subscribed).toContain("already has a subscription");
    expect(subscribed).not.toContain("Choose Pro");
    const manual = render(<UpgradePlans overview={overview({ checkoutBlockedReason: "plan_managed_manually" })} />);
    expect(manual).toContain("managed by an administrator");
  });
});
