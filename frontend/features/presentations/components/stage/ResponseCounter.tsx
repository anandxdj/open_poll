"use client";

import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";

/** "12 / 30 answered" pill in the stage's bottom-left corner (hidden on small screens). */
export function ResponseCounter() {
  const t = useTranslations("presenter.slide");
  const answeredCount = useLive((s) => s.answeredCount);
  const participantCount = useLive((s) => s.participants.length);

  return (
    <div className="absolute left-6 bottom-5 z-10 hidden sm:flex items-center gap-2 rounded-full border border-deck-stage-fg/10 bg-deck-stage-fg/5 backdrop-blur-md px-3.5 py-1.5 text-xs text-deck-stage-fg/80 shadow-md">
      <span className="size-2 rounded-full bg-deck-live animate-pulse shrink-0" />
      <span className="font-mono font-bold text-deck-stage-fg tracking-tight">{answeredCount}</span>
      <span className="text-deck-stage-fg/40 font-mono">/</span>
      <span className="font-mono text-deck-stage-fg/60">{participantCount}</span>
      <span className="text-deck-stage-fg/50 font-medium ml-0.5">{t("answered")}</span>
    </div>
  );
}
