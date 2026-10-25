"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/** Seconds since mount, ticking once a second. */
function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds;
}

/** Planning the outline (can be cancelled: nothing is stored yet). */
export function AiDeckPlanning({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("ai.deck.planning");
  const seconds = useElapsedSeconds();
  return (
    <div className="grid gap-5 py-6 text-center" role="status" aria-live="polite" data-testid="ai-deck-planning">
      <Loader2 className="mx-auto size-8 animate-spin text-accent-ink" aria-hidden />
      <div className="grid gap-1">
        <p className="text-base font-semibold">{t("title")}</p>
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
        <p className="text-xs tabular-nums text-muted-foreground" aria-hidden>
          {seconds}s
        </p>
      </div>
      <div className="flex justify-center">
        <Button type="button" variant="outline" className="rounded-xl" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </div>
  );
}

/** Writing the slides: no cancel, the server finishes the deck either way. */
export function AiDeckWriting({ slideCount }: { slideCount: number }) {
  const t = useTranslations("ai.deck.writing");
  const seconds = useElapsedSeconds();
  return (
    <div className="grid gap-5 py-6 text-center" role="status" aria-live="polite" data-testid="ai-deck-writing">
      <Loader2 className="mx-auto size-8 animate-spin text-accent-ink" aria-hidden />
      <div className="grid gap-1">
        <p className="text-base font-semibold">{t("title")}</p>
        <p className="text-sm text-muted-foreground">{t("hint", { count: slideCount })}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{t("elapsed", { seconds })}</p>
      </div>
    </div>
  );
}
