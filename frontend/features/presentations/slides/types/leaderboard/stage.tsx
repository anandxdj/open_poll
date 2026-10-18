"use client";

import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Leaderboard } from "../../../components/stage/Leaderboard";
import type { StageViewProps } from "../../runtime";

export function LeaderboardStage({ live, mode }: StageViewProps) {
  const t = useTranslations("live.leaderboard");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2 text-sm font-bold text-deck-primary">
        <Trophy className="size-4" /> {t("title")}
      </div>
      <Leaderboard entries={mode === "thumbnail" ? [] : live.leaderboard} />
    </div>
  );
}
