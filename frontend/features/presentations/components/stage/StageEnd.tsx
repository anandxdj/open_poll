"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";
import { SlotOutlet } from "../../live/slots";
import { Leaderboard } from "./Leaderboard";

/**
 * End-of-session screen: final standings, host actions, then `endScreen` slot
 * entries. A read-only screen (W4-D) shows the standings only: the slot's
 * host links lead to signed-in pages.
 */
export function StageEnd({ actions, slots = true }: { actions?: ReactNode; slots?: boolean }) {
  const t = useTranslations("live.leaderboard");
  const tp = useTranslations("presenter.end");
  const leaderboard = useLive((s) => s.leaderboard);
  const presentationId = useLive((s) => s.presentationId);

  return (
    <div className="relative my-auto w-full max-w-md space-y-6 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-4xl font-semibold tracking-[-0.04em] text-deck-stage-fg sm:text-5xl">{tp("title")}</h2>
      <Leaderboard entries={leaderboard} title={t("finalStandings")} final />
      {actions && <div className="flex flex-wrap items-center justify-center gap-3 pt-2">{actions}</div>}
      {slots && presentationId && <SlotOutlet name="endScreen" props={{ role: "host", presentationId }} />}
    </div>
  );
}
