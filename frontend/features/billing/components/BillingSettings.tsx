"use client";

import { useEffect, useState } from "react";
import { Info, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCurrentWorkspace } from "@/features/workspaces/hooks/useWorkspaces";
import { SettingsHeading } from "@/features/workspaces/settings/blocks";
import { useBilling } from "../hooks/useBilling";
import { BillingIntlProvider } from "./BillingIntlProvider";
import { PlanCard } from "./PlanCard";
import { UpgradePlans } from "./UpgradePlans";
import { UsageCard } from "./UsageCard";

const card = "rounded-xl border border-border bg-card p-5 sm:p-6";
const ACTIVATION_POLLS = 10;
const ACTIVATION_POLL_MS = 3_000;

type CheckoutReturn = "success" | "canceled" | null;

/** `?checkout=success|canceled`, appended by the success and cancel URLs of the Checkout session. */
function readCheckoutReturn(): CheckoutReturn {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("checkout");
  return value === "success" || value === "canceled" ? value : null;
}

function BillingContent() {
  const t = useTranslations("billing");
  const { detail, failed: workspaceFailed, retry } = useCurrentWorkspace();
  const canManage = detail?.permissions.includes("workspace:billing") ?? false;
  const { overview, loading, failed, reload, refresh } = useBilling(detail && canManage ? detail.workspace._id : null);
  const [returned] = useState<CheckoutReturn>(readCheckoutReturn);
  const [polls, setPolls] = useState(0);

  // After paying, the plan changes when Stripe's webhook arrives: poll until it does.
  const waitingForPlan = returned === "success" && overview !== null && overview.enabled && overview.plan === "free";
  useEffect(() => {
    if (!waitingForPlan || polls >= ACTIVATION_POLLS) return;
    const timer = window.setTimeout(() => {
      void refresh().finally(() => setPolls((value) => value + 1));
    }, ACTIVATION_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [waitingForPlan, polls, refresh]);

  const header = <SettingsHeading title={t("title")} description={t("description")} />;

  if (workspaceFailed || failed) {
    return (
      <div className={`${card} space-y-3`}>
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
        <Button variant="outline" onClick={workspaceFailed ? retry : reload}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (detail && !canManage) {
    return (
      <div className="space-y-6">
        {header}
        <p className={`${card} text-sm text-muted-foreground`} data-testid="billing-owner-only">
          {t("ownerOnly")}
        </p>
      </div>
    );
  }

  if (!detail || loading || !overview) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const planActivated = returned === "success" && overview.plan !== "free";

  return (
    <div className="space-y-12">
      {header}

      {!overview.enabled ? (
        <div role="status" className="flex gap-3 rounded-xl border border-border bg-secondary/60 p-5 sm:p-6" data-testid="billing-disabled">
          <Info className="mt-0.5 size-5 shrink-0 text-accent-ink" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{t("disabled.title")}</p>
            <p className="text-sm text-muted-foreground">{t("disabled.body")}</p>
          </div>
        </div>
      ) : null}

      {returned === "success" ? (
        <p role="status" className={`${card} text-sm text-foreground`} data-testid="checkout-status">
          {planActivated ? t("checkout.activated") : polls >= ACTIVATION_POLLS ? t("checkout.delayed") : t("checkout.activating")}
        </p>
      ) : null}
      {returned === "canceled" ? (
        <p role="status" className={`${card} text-sm text-muted-foreground`} data-testid="checkout-status">
          {t("checkout.canceled")}
        </p>
      ) : null}

      <PlanCard overview={overview} />
      <UsageCard overview={overview} />
      {overview.enabled ? <UpgradePlans overview={overview} /> : null}
    </div>
  );
}

/** Content of /settings/billing: plan, usage and the way to subscribe or manage billing. */
export function BillingSettings() {
  return (
    <BillingIntlProvider>
      <BillingContent />
    </BillingIntlProvider>
  );
}
