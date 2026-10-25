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
    <div className="max-w-xl w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto">
      <Presentation className="size-12 text-deck-primary mx-auto" />
      <div className="space-y-2">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-deck-stage-fg">{t("title")}</h2>
        <p className="text-sm font-semibold text-deck-stage-fg/70 truncate">
          {title} · {totalSlides}
        </p>
        <p className="text-xs text-deck-stage-fg/50 max-w-md mx-auto">{t("hint")}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-3 pt-2">{actions}</div>}
    </div>
  );
}
