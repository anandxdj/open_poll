"use client";

import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";
import { Leaderboard } from "../stage/Leaderboard";

/** Host-only overlay with the live standings. */
export function LeaderboardModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("presenter.leaderboardModal");
  const leaderboard = useLive((s) => s.leaderboard);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-deck-stage-scrim/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md space-y-5 rounded-2xl border border-deck-stage-fg/15 bg-deck-stage-panel p-6 shadow-[0_32px_64px_-24px_rgb(0_0_0/0.7)]">
        <div className="flex items-center justify-between border-b border-deck-stage-fg/10 pb-4">
          <div className="flex items-center gap-2 text-lg font-semibold text-deck-stage-fg">
            <Trophy className="size-5 text-deck-rank-1" /> {t("title")}
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="size-8 rounded-full bg-deck-stage-fg/10 hover:bg-deck-stage-fg/20 text-deck-stage-fg flex items-center justify-center transition-colors text-xs font-bold"
          >
            ✕
          </button>
        </div>
        <Leaderboard entries={leaderboard} />
      </div>
    </div>
  );
}
