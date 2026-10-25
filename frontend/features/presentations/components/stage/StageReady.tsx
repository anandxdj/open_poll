"use client";

import type { ReactNode } from "react";
import { Presentation } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";

/**
 * Before the first run (no session yet): nothing is open, nobody can join.
 * The host decides how to begin — present right away, or open the lobby first —
 * through `actions`. Opening this page never starts either by itself.
 */
export function StageReady({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("presenter.ready");
  const title = useLive((s) => s.title);
  const totalSlides = useLive((s) => s.totalSlides);

  return (
    <div className="relative my-auto w-full max-w-xl space-y-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Presentation className="mx-auto size-10 text-deck-accent" />
      <div className="space-y-3">
        <h2 className="text-4xl font-semibold tracking-[-0.04em] text-deck-stage-fg sm:text-5xl">{t("title")}</h2>
        <p className="truncate text-base text-deck-stage-fg/80">
          {title} <span className="font-mono text-sm text-deck-stage-fg/50">({totalSlides})</span>
        </p>
        <p className="mx-auto max-w-md text-sm text-deck-stage-fg/60">{t("hint")}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-3 pt-2">{actions}</div>}
    </div>
  );
}
