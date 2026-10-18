"use client";

import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Leaderboard } from "../../../components/stage/Leaderboard";
import { useLiveOptional } from "../../../live/store";

/**
 * The standings sent with `leaderboard:shown`, the participant's own row
 * highlighted. Ignores the slide props: everything comes from the live store.
 */
export function LeaderboardParticipant() {
  const t = useTranslations("live.leaderboard");
  const entries = useLiveOptional((s) => s.leaderboard);
  const participantId = useLiveOptional((s) => s.self?.participantId);

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-center gap-2 text-sm font-bold text-deck-primary">
        <Trophy className="size-4" /> {t("title")}
      </div>
      <Leaderboard entries={entries} highlightParticipantId={participantId} />
    </div>
  );
}
