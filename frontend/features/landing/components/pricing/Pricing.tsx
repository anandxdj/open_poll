"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlanCatalog } from "@/features/billing/hooks/usePlanCatalog";
import { bestYearlySavings, hasIntervalChoice, pricingTiers, type PricingTier } from "@/features/billing/lib/catalog";
import { formatMoney } from "@/features/billing/lib/format";
import type { BillingInterval } from "@/features/billing/types";
import { Badge } from "@/components/ui/badge";
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
    return <span className="text-5xl font-semibold tracking-[-0.045em]">Free</span>;
  }
  if (price.kind === "custom") {
    // Enterprise is quoted; a paid plan with no price configured says so instead of implying a quote.
    return tier.plan.id === "enterprise" ? (
      <span className="text-5xl font-semibold tracking-[-0.045em]">Custom</span>
    ) : (
      // Same 48px line as the big prices so the cards' bullet lists start level.
      <span className="text-2xl font-semibold leading-[3rem] tracking-[-0.02em] text-muted-foreground">Pricing soon</span>
    );
  }
  return (
    <>
      <span className="text-5xl font-semibold tracking-[-0.045em] tabular-nums">
        {formatMoney(price.amount.amount, price.amount.currency)}
      </span>
      <span className="text-sm leading-6 text-muted-foreground">
        {tier.plan.perSeat ? "/seat/month" : "/month"}
      </span>
    </>
  );
}

/** 44px tall, full width inside the card, a pill like every marketing button. */
const BTN = "h-11 w-full rounded-full";

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
    <section id="pricing" aria-labelledby="pricing-title" className={`${sectionY} scroll-mt-20 border-t border-border`}>
      <div className={container}>
        <SectionHeading
          id="pricing-title"
          title="Pick the plan that fits your audience"
          description="Start free. Upgrade when you need a bigger room, more AI drafts or a team workspace."
        />

        {hasIntervalChoice(catalog) && (
          <div className="mt-10 flex items-center gap-x-4">
            <Label
              htmlFor="billing-toggle"
              className={cn(
                "min-h-11 text-sm font-medium transition-colors",
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
                "min-h-11 text-sm font-medium transition-colors",
                isAnnual ? "text-foreground" : "text-muted-foreground"
              )}
            >
              Yearly
              {savings !== null && <Badge variant="accent">{savings}% off</Badge>}
            </Label>
          </div>
        )}

        <div className="mt-12 grid grid-cols-1 gap-4 md:mt-14 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.plan.id}
              data-testid={`pricing-${tier.plan.id}`}
              className={cn(
                "gap-6 rounded-2xl py-6",
                // The recommended plan is the one dark sheet on the paper (the `dark` class re-applies the dark tokens).
                tier.mostPopular && "dark border-primary/60 bg-card text-card-foreground shadow-[0_24px_48px_-24px_rgb(23_23_23/0.45)]"
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{tier.plan.name}</CardTitle>
                  {tier.mostPopular && <Badge variant="accent">Most popular</Badge>}
                </div>
                <CardDescription className="min-h-[3.25rem] text-sm leading-relaxed">
                  {DESCRIPTIONS[tier.plan.id] ?? ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-5">
                <div className="flex items-baseline gap-x-1">
                  <TierPrice tier={tier} />
                </div>
                {tier.price.kind === "priced" && tier.price.billedAs && (
                  <p className="text-sm text-accent-ink">
                    Billed annually ({formatMoney(tier.price.billedAs.amount, tier.price.billedAs.currency)}
                    {tier.plan.perSeat ? "/seat" : ""}/year)
                  </p>
                )}
                <ul className="space-y-2.5 border-t border-border pt-5">
                  {tier.highlights.map((feature) => (
                    <li key={feature} className="flex gap-x-3 text-sm leading-snug">
                      <Check className="mt-0.5 size-4 flex-none text-accent-ink" strokeWidth={2.25} aria-hidden="true" />
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
