"use client";

import { FlaskConical, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * The mock-mode label: shown wherever a generated deck (or outline) could be
 * mistaken for model output. Mock content is placeholder text built from the topic.
 */
export function MockDataNotice({
  className,
  compact = false,
  onDismiss,
}: {
  className?: string;
  compact?: boolean;
  /** Adds a close button (the builder banner). */
  onDismiss?: () => void;
}) {
  const t = useTranslations("ai.deck.mockNotice");
  const banner = useTranslations("ai.deck.banner");
  return (
    <div
      role="status"
      data-testid="ai-deck-mock-notice"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground",
        className
      )}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="flex-1 space-y-0.5">
        <p className="font-semibold">{t("title")}</p>
        {!compact && <p className="text-muted-foreground">{t("body")}</p>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={banner("dismiss")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-warning/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
