"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlanCatalog } from "@/features/billing/hooks/usePlanCatalog";
import { bestYearlySavings, hasIntervalChoice, pricingTiers, type PricingTier } from "@/features/billing/lib/catalog";
import { formatMoney } from "@/features/billing/lib/format";
import type { BillingInterval } from "@/features/billing/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { container, sectionY } from "../shared/styles";
import { SectionHeading } from "../shared/SectionHeading";

/** Marketing line per plan. Limits, features and prices come from GET /api/plans. */
const DESCRIPTIONS: Record<string, string> = {
  free: "Perfect for trying Open Poll and small sessions.",
  pro: "Advanced features for creators and power users.",
  team: "Shared decks, roles and per-seat pricing for teams.",
  enterprise: "Dedicated solutions for large teams and organizations.",
};

/** Where "Contact sales" goes; without it the button stays disabled rather than doing nothing. */
const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL;

function TierPrice({ tier }: { tier: PricingTier }) {
  const { price } = tier;
  if (price.kind === "free") {
    return <span className="text-4xl font-bold tracking-tight">Free</span>;
  }
  if (price.kind === "custom") {
    // Enterprise is quoted; a paid plan with no price configured says so instead of implying a quote.
    return tier.plan.id === "enterprise" ? (
      <span className="text-4xl font-bold tracking-tight">Custom</span>
    ) : (
      // Same 40px line as the big prices so the cards' bullet lists start level.
      <span className="text-2xl font-bold leading-10 tracking-tight text-muted-foreground">Pricing soon</span>
    );
  }
  return (
    <>
      <span className="text-4xl font-bold tracking-tight">{formatMoney(price.amount.amount, price.amount.currency)}</span>
      <span className="text-sm font-medium leading-6 text-muted-foreground">
        {tier.plan.perSeat ? "/seat/month" : "/month"}
      </span>
    </>
  );
}

/** 44px tall, rounded like the rest of the marketing buttons, with a focus ring that reads on light. */
const BTN = "h-11 w-full rounded-2xl text-sm font-semibold focus-visible:border-brand-ink focus-visible:ring-brand-ink/40";

function TierCta({ tier }: { tier: PricingTier }) {
  const variant = tier.mostPopular ? "default" : "outline";
  const id = tier.plan.id;
  if (id === "free") {
    return (
      <Button asChild className={BTN} variant={variant}>
        <Link href="/signup">Get started</Link>
      </Button>
    );
  }
  if (id === "enterprise") {
    return SALES_EMAIL ? (
      <Button asChild className={BTN} variant={variant}>
        <a href={`mailto:${SALES_EMAIL}`}>Contact sales</a>
      </Button>
    ) : (
      <Button className={BTN} variant={variant} disabled aria-describedby="sales-unavailable">
        Contact sales
      </Button>
    );
  }
  return (
    <Button asChild className={BTN} variant={variant}>
      <Link href="/settings/billing">Upgrade to {tier.plan.name}</Link>
    </Button>
  );
}

export function Pricing() {
  const [isAnnual, setIsAnnual] = useState(false);
  const { catalog } = usePlanCatalog();
  const interval: BillingInterval = isAnnual ? "yearly" : "monthly";
  const tiers = pricingTiers(catalog, interval);
  const savings = bestYearlySavings(catalog);

  return (
    <section id="pricing" aria-labelledby="pricing-title" className={`${sectionY} relative scroll-mt-20 overflow-hidden border-t border-border`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-full max-w-7xl">
        <div className="absolute left-1/4 top-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className={container}>
        <SectionHeading
          id="pricing-title"
          title="Pick the plan that fits your audience"
          description="Start free. Upgrade when you need a bigger room, more AI drafts or a team workspace."
        />

        {hasIntervalChoice(catalog) && (
          <div className="mt-10 flex items-center justify-center gap-x-4">
            <Label
              htmlFor="billing-toggle"
              className={cn(
                "min-h-11 text-base font-medium transition-colors",
                !isAnnual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Monthly
            </Label>
            <Switch
              id="billing-toggle"
              checked={isAnnual}
              onCheckedChange={setIsAnnual}
            />
            <Label
              htmlFor="billing-toggle"
              className={cn(
                "min-h-11 text-base font-medium transition-colors",
                isAnnual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Yearly
              {savings !== null && (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-sm font-medium text-brand-ink ring-1 ring-inset ring-primary/30">
                  {savings}% off
                </span>
              )}
            </Label>
          </div>
        )}

        <div className="mt-14 grid grid-cols-1 gap-6 pt-3 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.plan.id}
              data-testid={`pricing-${tier.plan.id}`}
              className={cn(
                "relative flex flex-col overflow-visible ring-1 transition-colors duration-500",
                tier.mostPopular
                  ? "bg-primary/[0.05] ring-2 ring-primary"
                  : "ring-foreground/10 hover:ring-foreground/25"
              )}
            >
              {tier.mostPopular && (
                <div className="absolute -top-3.5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-4 py-1 text-sm font-semibold text-primary-foreground shadow-md">
                  Most popular
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-2xl font-bold tracking-tight">{tier.plan.name}</CardTitle>
                <CardDescription className="min-h-[3rem] text-base">
                  {DESCRIPTIONS[tier.plan.id] ?? ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-6">
                <div className="flex items-baseline gap-x-1">
                  <TierPrice tier={tier} />
                </div>
                {tier.price.kind === "priced" && tier.price.billedAs && (
                  <p className="text-sm font-medium text-brand-ink">
                    Billed annually ({formatMoney(tier.price.billedAs.amount, tier.price.billedAs.currency)}
                    {tier.plan.perSeat ? "/seat" : ""}/year)
                  </p>
                )}
                <ul className="space-y-3">
                  {tier.highlights.map((feature) => (
                    <li key={feature} className="flex gap-x-3 text-base leading-snug">
                      <Check className="mt-0.5 size-5 flex-none text-brand-ink" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {tier.plan.id === "enterprise" && !SALES_EMAIL ? (
                  <p id="sales-unavailable" className="text-sm text-muted-foreground">
                    Sales contact is not open yet.
                  </p>
                ) : null}
              </CardContent>
              <CardFooter>
                <TierCta tier={tier} />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
