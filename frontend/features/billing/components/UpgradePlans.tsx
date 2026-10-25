"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { startCheckout } from "../api/billing.api";
import { usePlanCatalog } from "../hooks/usePlanCatalog";
import { bestYearlySavings, hasIntervalChoice, planHighlights } from "../lib/catalog";
import { formatMoney, perMonth } from "../lib/format";
import type { BillingInterval, BillingOverview, PaidPlanId } from "../types";

const PAID: PaidPlanId[] = ["pro", "team"];
const SEATS_MAX = 1000;

/** Subscribe to Pro or Team; the browser goes to Stripe Checkout. Only shown when billing is on. */
export function UpgradePlans({ overview }: { overview: BillingOverview }) {
  const t = useTranslations("billing.upgrade");
  const { catalog } = usePlanCatalog();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  // null until the buyer types: the field then shows one seat per member.
  const [seatsInput, setSeatsInput] = useState<string | null>(null);
  const [busy, setBusy] = useState<PaidPlanId | null>(null);

  const members = overview.seats.used;
  const parsedSeats = Number.parseInt(seatsInput ?? "", 10);
  const seats = Number.isFinite(parsedSeats) ? Math.min(SEATS_MAX, Math.max(members, parsedSeats, 1)) : Math.max(members, 1);
  const savings = bestYearlySavings(catalog);

  const choose = async (plan: PaidPlanId) => {
    setBusy(plan);
    try {
      window.location.assign(await startCheckout({ plan, interval, ...(plan === "team" ? { seats } : {}) }));
    } catch (error) {
      setBusy(null);
      toast.error(getApiErrorMessage(error) ?? t("checkoutError"));
    }
  };

  const blocked = overview.checkoutBlockedReason;
  if (blocked) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-bold text-foreground/90">{t("heading")}</h2>
        <p className="rounded-[1.5rem] border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="upgrade-blocked">
          {blocked === "already_subscribed" ? t("alreadySubscribed") : t("managedManually")}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground/90">{t("heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {hasIntervalChoice(catalog) ? (
        <div className="flex items-center gap-4">
          <Label htmlFor="billing-interval" className={cn("text-sm", interval === "monthly" ? "text-foreground" : "text-muted-foreground")}>
            {t("monthly")}
          </Label>
          <Switch id="billing-interval" checked={interval === "yearly"} onCheckedChange={(on) => setInterval(on ? "yearly" : "monthly")} />
          <Label htmlFor="billing-interval" className={cn("text-sm", interval === "yearly" ? "text-foreground" : "text-muted-foreground")}>
            {t("yearly")}
            {savings ? (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/20">
                {t("save", { percent: savings })}
              </span>
            ) : null}
          </Label>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        {PAID.map((id) => {
          const plan = catalog.plans.find((candidate) => candidate.id === id);
          if (!plan) return null;
          const price = plan.prices?.[interval] ?? null;
          const available = overview.checkout[id][interval];
          const current = overview.plan === id;
          return (
            <div key={id} className="flex flex-col gap-5 rounded-[1.5rem] border border-border bg-card p-6" data-testid={`upgrade-${id}`}>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-foreground/90">{plan.name}</h3>
                {price ? (
                  <div>
                    <p className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold tracking-tight">{formatMoney(perMonth(price, interval).amount, price.currency)}</span>
                      <span className="text-sm text-muted-foreground">{plan.perSeat ? t("perSeatMonth") : t("perMonth")}</span>
                    </p>
                    {interval === "yearly" ? (
                      <p className="text-xs text-muted-foreground">{t("billedYearly", { amount: formatMoney(price.amount, price.currency) })}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("priceAtCheckout")}</p>
                )}
              </div>

              <ul className="flex-1 space-y-2">
                {planHighlights(plan)
                  .slice(0, 6)
                  .map((line) => (
                    <li key={line} className="flex gap-2 text-sm text-foreground/80">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      {line}
                    </li>
                  ))}
              </ul>

              {plan.perSeat ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`seats-${id}`}>{t("seats")}</Label>
                  <Input
                    id={`seats-${id}`}
                    type="number"
                    inputMode="numeric"
                    min={Math.max(1, members)}
                    max={SEATS_MAX}
                    value={seatsInput ?? String(Math.max(members, 1))}
                    onChange={(event) => setSeatsInput(event.target.value)}
                    className="w-28 rounded-xl"
                  />
                  <p className="text-xs text-muted-foreground">{t("seatsHint", { members })}</p>
                </div>
              ) : null}

              <Button
                className="w-full rounded-xl"
                disabled={!available || current || busy !== null}
                onClick={() => void choose(id)}
                data-testid={`choose-${id}`}
              >
                {busy === id ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy === id ? t("redirecting") : current ? t("current") : available ? t("choose", { plan: plan.name }) : t("unavailable")}
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t("enterprise")}</p>
    </section>
  );
}
