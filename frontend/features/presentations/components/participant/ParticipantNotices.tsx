"use client";

import { Ban, PartyPopper, Presentation as PresentationIcon, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

const centered = "min-h-screen bg-deck-bg text-deck-fg flex items-center justify-center p-6 text-center";

/** The code matches no deck, or the deck was never presented. */
export function ParticipantNotFound() {
  const t = useTranslations("live.participant");
  return (
    <div className={centered}>
      <div className="space-y-3">
        <PresentationIcon className="size-10 text-deck-muted-fg/40 mx-auto" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{t("notFoundTitle")}</h1>
        <p className="text-sm text-deck-muted-fg">{t("notFoundHint")}</p>
      </div>
    </div>
  );
}

/** The host removed this participant: no rejoin for this session. */
export function ParticipantKicked() {
  const t = useTranslations("live.participant");
  return (
    <div className={centered}>
      <div className="space-y-3 max-w-sm">
        <Ban className="size-10 text-deck-wrong mx-auto" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{t("kickedTitle")}</h1>
        <p className="text-sm text-deck-muted-fg">{t("kickedHint")}</p>
      </div>
    </div>
  );
}

/** The deck has no live session and this device has no standings to show. */
export function ParticipantSessionClosed() {
  const t = useTranslations("live.participant");
  return (
    <div className={centered}>
      <div className="space-y-3 max-w-sm">
        <PartyPopper className="size-10 text-deck-muted-fg/40 mx-auto" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{t("endedTitle")}</h1>
        <p className="text-sm text-deck-muted-fg">{t("endedHint")}</p>
      </div>
    </div>
  );
}

/** Shown over a finished session's screen when the host started another run. */
export function NewSessionNotice({ onJoin }: { onJoin: () => void }) {
  const t = useTranslations("live.participant");
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 border-b border-deck-border bg-deck-surface px-4 py-2.5 text-center text-sm"
    >
      <span className="flex items-center gap-1.5 font-semibold text-deck-fg">
        <Radio className="size-3.5 animate-pulse" /> {t("newSessionTitle")}
      </span>
      <span className="text-deck-muted-fg">{t("newSessionHint")}</span>
      <Button size="sm" onClick={onJoin} className="h-8 rounded-full bg-deck-primary px-3.5 text-sm font-semibold text-deck-primary-fg">
        {t("newSessionJoin")}
      </Button>
    </div>
  );
}
