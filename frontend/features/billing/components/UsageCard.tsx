"use client";

import { useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { formatLimit, usagePercent } from "../lib/format";
import type { BillingOverview } from "../types";

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const t = useTranslations("billing.usage");
  const text =
    limit === null
      ? t("ofUnlimited", { used: formatLimit(used) })
      : t("ofLimit", { used: formatLimit(used), limit: formatLimit(limit) });
  const percent = usagePercent(used, limit);

  return (
    <div className="space-y-2" data-testid="usage-meter">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium text-foreground/90">{label}</span>
        <span className="tabular-nums text-muted-foreground">{text}</span>
      </div>
      <Progress
        value={percent}
        aria-label={`${label}: ${text}`}
        className={percent >= 100 ? "[&>*]:bg-destructive" : undefined}
      />
    </div>
  );
}

/** Monthly allowances and seats against the plan's limits. */
export function UsageCard({ overview }: { overview: BillingOverview }) {
  const t = useTranslations("billing.usage");
  const counter = (name: "ai_deck" | "import") => overview.usage.find((meter) => meter.counter === name);
  const decks = counter("ai_deck");
  const imports = counter("import");

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-foreground/90">{t("heading")}</h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="space-y-6 rounded-[1.5rem] border border-border bg-card p-6">
        {decks ? <Meter label={t("aiDecks")} used={decks.used} limit={decks.limit} /> : null}
        {imports ? <Meter label={t("imports")} used={imports.used} limit={imports.limit} /> : null}
        <Meter label={t("members")} used={overview.seats.used} limit={overview.seats.limit} />
        <div className="flex items-baseline justify-between gap-4 border-t border-border pt-4 text-sm">
          <span className="font-medium text-foreground/90">{t("participants")}</span>
          <span className="tabular-nums text-muted-foreground">
            {formatLimit(overview.entitlements.limits.audienceCap)}
          </span>
        </div>
      </div>
    </section>
  );
}
