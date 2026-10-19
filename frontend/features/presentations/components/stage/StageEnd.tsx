"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";
import { SlotOutlet } from "../../live/slots";
import { Leaderboard } from "./Leaderboard";

/** End-of-session screen: final standings, host actions, then `endScreen` slot entries. */
export function StageEnd({ actions }: { actions?: ReactNode }) {
  const t = useTranslations("live.leaderboard");
  const tp = useTranslations("presenter.end");
  const leaderboard = useLive((s) => s.leaderboard);
  const presentationId = useLive((s) => s.presentationId);

  return (
    <div className="max-w-md w-full space-y-6 text-center animate-in fade-in slide-in-from-bottom-8 duration-700 my-auto">
      <h2 className="text-2xl font-bold">{tp("title")}</h2>
      <Leaderboard entries={leaderboard} title={t("finalStandings")} />
      {actions && <div className="flex flex-wrap items-center justify-center gap-3 pt-2">{actions}</div>}
      {presentationId && <SlotOutlet name="endScreen" props={{ role: "host", presentationId }} />}
    </div>
  );
}
