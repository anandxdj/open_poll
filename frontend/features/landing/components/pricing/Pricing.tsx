"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
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

const tiers = [
  {
    name: "Free",
    id: "tier-free",
    priceMonthly: "$0",
    priceYearly: "$0",
    description: "Perfect for hobbyists and small simple polls.",
    features: [
      "Unlimited public polls",
      "Up to 100 responses per poll",
      "Basic real-time analytics",
      "Standard community support",
      "Mobile responsive design",
    ],
    cta: "Get Started",
    mostPopular: false,
  },
  {
    name: "Pro",
    id: "tier-pro",
    priceMonthly: "$15",
    priceYearly: "$12",
    description: "Advanced features for creators and power users.",
    features: [
      "Unlimited responses per poll",
      "AI-powered poll drafting",
      "Export results (CSV, PDF, Excel)",
      "Custom branding & colors",
      "Password protected polls",
      "Priority email support",
    ],
    cta: "Upgrade to Pro",
    mostPopular: true,
  },
  {
    name: "Enterprise",
    id: "tier-enterprise",
    priceMonthly: "Custom",
    priceYearly: "Custom",
    description: "Dedicated solutions for large teams and organizations.",
    features: [
      "Unlimited everything",
      "SSO & SAML authentication",
      "Custom domain support",
      "API access & webhooks",
      "Dedicated account manager",
      "24/7 Phone & Slack support",
    ],
    cta: "Contact Sales",
    mostPopular: false,
  },
];

export function Pricing() {
  const [isAnnual, setIsAnnual] = useState(false);

  return (
    <section id="pricing" className="relative py-32 px-6 overflow-hidden">
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
              <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                20% off
              </span>
            </Label>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {tiers.map((tier) => (
            <Card
              key={tier.id}
              className={cn(
                "relative flex flex-col border transition-all duration-300",
                tier.mostPopular
                  ? "border-primary shadow-lg scale-105 z-10 bg-primary/[0.02]"
                  : "border-border hover:border-primary/50"
              )}
            >
              {tier.mostPopular && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 z-20 rounded-full bg-primary px-6 py-1.5 text-base font-bold text-primary-foreground shadow-md">
                  Most Popular
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-xl">{tier.name}</CardTitle>
                <CardDescription className="min-h-[3rem]">
                  {tier.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-6">
                <div className="flex items-baseline gap-x-1">
                  <span className="text-4xl font-bold tracking-tight">
                    {isAnnual ? tier.priceYearly : tier.priceMonthly}
                  </span>
                  {tier.priceMonthly !== "Custom" && (
                    <span className="text-sm font-semibold leading-6 text-muted-foreground">
                      /month
                    </span>
                  )}
                </div>
                {isAnnual && tier.priceMonthly !== "Custom" && tier.priceYearly !== "$0" && (
                  <p className="text-xs text-primary font-medium">
                    Billed annually (${Number(tier.priceYearly.replace('$', '')) * 12}/year)
                  </p>
                )}
                <ul className="space-y-3">
                  {tier.features.map((feature) => (
                    <li key={feature} className="flex gap-x-3 text-sm leading-6">
                      <Check className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={tier.mostPopular ? "default" : "outline"}
                >
                  {tier.cta}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
