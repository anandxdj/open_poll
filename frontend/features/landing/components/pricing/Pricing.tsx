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
    return <span className="text-4xl font-bold tracking-tight">Custom</span>;
  }
  return (
    <>
      <span className="text-4xl font-bold tracking-tight">{formatMoney(price.amount.amount, price.amount.currency)}</span>
      <span className="text-sm font-semibold leading-6 text-muted-foreground">
        {tier.plan.perSeat ? "/seat/month" : "/month"}
      </span>
    </>
  );
}

function TierCta({ tier }: { tier: PricingTier }) {
  const variant = tier.mostPopular ? "default" : "outline";
  const id = tier.plan.id;
  if (id === "free") {
    return (
      <Button asChild className="w-full" variant={variant}>
        <Link href="/signup">Get started</Link>
      </Button>
    );
  }
  if (id === "enterprise") {
    return SALES_EMAIL ? (
      <Button asChild className="w-full" variant={variant}>
        <a href={`mailto:${SALES_EMAIL}`}>Contact sales</a>
      </Button>
    ) : (
      <Button className="w-full" variant={variant} disabled>
        Contact sales
      </Button>
    );
  }
  return (
    <Button asChild className="w-full" variant={variant}>
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
    <section id="pricing" className="relative py-32 px-6 overflow-hidden scroll-mt-20">
      {/* Background decoration */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-full -z-10 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-base font-semibold leading-7 text-primary tracking-wide uppercase">
            Pricing
          </h2>
          <p className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            Choose the right plan for you
          </p>
          <p className="mx-auto max-w-2xl text-lg leading-8 text-muted-foreground">
            Whether you&apos;re just starting out or running large-scale data collection, we have a plan that fits your needs.
          </p>

          {hasIntervalChoice(catalog) && (
            <div className="mt-10 flex items-center justify-center gap-x-4">
              <Label
                htmlFor="billing-toggle"
                className={cn(
                  "text-sm font-medium transition-colors",
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
                  "text-sm font-medium transition-colors",
                  isAnnual ? "text-foreground" : "text-muted-foreground"
                )}
              >
                Yearly
                {savings !== null && (
                  <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                    {savings}% off
                  </span>
                )}
              </Label>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-4">
          {tiers.map((tier) => (
            <Card
              key={tier.plan.id}
              data-testid={`pricing-${tier.plan.id}`}
              className={cn(
                "relative flex flex-col border transition-all duration-300 overflow-visible",
                tier.mostPopular
                  ? "border-primary shadow-lg xl:scale-105 z-10 bg-primary/[0.02]"
                  : "border-border hover:border-primary/50"
              )}
            >
              {tier.mostPopular && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-20 rounded-full bg-primary px-6 py-1.5 text-base font-bold text-primary-foreground shadow-md">
                  Most Popular
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl">{tier.plan.name}</CardTitle>
                <CardDescription className="min-h-[3rem]">
                  {DESCRIPTIONS[tier.plan.id] ?? ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-6">
                <div className="flex items-baseline gap-x-1">
                  <TierPrice tier={tier} />
                </div>
                {tier.price.kind === "priced" && tier.price.billedAs && (
                  <p className="text-xs text-primary font-medium">
                    Billed annually ({formatMoney(tier.price.billedAs.amount, tier.price.billedAs.currency)}
                    {tier.plan.perSeat ? "/seat" : ""}/year)
                  </p>
                )}
                <ul className="space-y-3">
                  {tier.highlights.map((feature) => (
                    <li key={feature} className="flex gap-x-3 text-sm leading-6">
                      <Check className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
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
