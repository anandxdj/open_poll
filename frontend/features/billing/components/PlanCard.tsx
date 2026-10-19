"use client";

import { useState } from "react";
import { AlertTriangle, CreditCard, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-error";
import { PLAN_NAMES } from "@/features/workspaces/types";
import { openBillingPortal } from "../api/billing.api";
import { formatDate } from "../lib/format";
import { isProblemStatus, planStatusKey } from "../lib/status";
import type { BillingOverview } from "../types";

/** The workspace's current plan, its status, renewal and the way into the billing portal. */
export function PlanCard({ overview }: { overview: BillingOverview }) {
  const t = useTranslations("billing.plan");
  const [opening, setOpening] = useState(false);
  const statusKey = planStatusKey(overview);
  const problem = isProblemStatus(statusKey);
  const periodEnd = overview.currentPeriodEnd ? formatDate(overview.currentPeriodEnd) : null;

  const openPortal = async () => {
    setOpening(true);
    try {
      window.location.assign(await openBillingPortal());
    } catch (error) {
      setOpening(false);
      toast.error(getApiErrorMessage(error) ?? t("portalError"));
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="billing-plan-heading">
      <div className="space-y-1">
        <h2 id="billing-plan-heading" className="text-xl font-bold text-foreground/90" data-testid="billing-plan-name">
          {t("heading", { plan: PLAN_NAMES[overview.plan] })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("workspace", { name: overview.workspace.name })}</p>
      </div>

      <div className="space-y-5 rounded-[1.5rem] border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span
            data-testid="billing-status"
            className={
              "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset " +
              (problem
                ? "bg-destructive/10 text-destructive ring-destructive/30"
                : statusKey === "active" || statusKey === "trialing"
                  ? "bg-primary/10 text-primary ring-primary/30"
                  : "bg-secondary text-muted-foreground ring-border")
            }
          >
            {t(`status.${statusKey}`)}
          </span>
          {overview.subscription ? (
            <span className="text-sm text-muted-foreground">{t(`interval.${overview.subscription.interval}`)}</span>
          ) : null}
          {periodEnd && overview.status && statusKey !== "canceled" ? (
            <span className="text-sm text-muted-foreground">
              {overview.cancelAtPeriodEnd ? t("endsOn", { date: periodEnd }) : t("renews", { date: periodEnd })}
            </span>
          ) : null}
        </div>

        {overview.paymentFailed ? (
          <div role="alert" className="flex gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{t("paymentFailed")}</p>
          </div>
        ) : null}

        {overview.planSource === "manual" ? (
          <p className="text-sm text-muted-foreground">{t("managedManually")}</p>
        ) : null}

        {overview.enabled && overview.canOpenPortal ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t("portalHint")}</p>
            <Button className="shrink-0 rounded-xl" onClick={() => void openPortal()} disabled={opening}>
              {opening ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              {opening ? t("opening") : t("manage")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
