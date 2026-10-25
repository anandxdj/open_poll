"use client";

import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";

/** "12 / 30 answered" pill in the stage's bottom-left corner (hidden on small screens). */
export function ResponseCounter() {
  const t = useTranslations("presenter.slide");
  const answeredCount = useLive((s) => s.answeredCount);
  const participantCount = useLive((s) => s.participants.length);

  return (
    <div className="absolute bottom-5 left-6 z-10 hidden items-center gap-2 rounded-full border border-deck-stage-fg/15 bg-deck-stage-chrome px-3.5 py-1.5 text-sm text-deck-stage-fg/80 sm:flex">
      <span className="size-2 shrink-0 rounded-full bg-deck-live motion-safe:animate-pulse" />
      <span className="font-mono font-medium tabular-nums text-deck-stage-fg">{answeredCount}</span>
      <span className="font-mono text-deck-stage-fg/40">/</span>
      <span className="font-mono tabular-nums text-deck-stage-fg/60">{participantCount}</span>
      <span className="ml-0.5 text-deck-stage-fg/60">{t("answered")}</span>
    </div>
  );
}
