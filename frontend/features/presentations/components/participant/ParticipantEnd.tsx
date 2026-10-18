"use client";

import { PartyPopper } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLive } from "../../live/store";
import { SlotOutlet } from "../../live/slots";
import { Leaderboard } from "../stage/Leaderboard";

/** Participant end screen: own result, final standings, then `endScreen` slot entries. */
export function ParticipantEnd() {
  const t = useTranslations("live");
  const me = useLive((s) => s.me);
  const leaderboard = useLive((s) => s.leaderboard);
  const participantId = useLive((s) => s.self?.participantId);
  const presentationId = useLive((s) => s.presentationId);

  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      <div className="space-y-2">
        <PartyPopper className="size-10 text-deck-primary mx-auto" />
        <h2 className="text-2xl font-bold tracking-tight">{t("participant.endTitle")}</h2>
        {me && (
          <p className="text-sm text-deck-muted-fg">
            {t.rich("participant.endSummary", {
              rank: me.rank,
              score: me.totalScore.toLocaleString(),
              correct: me.correctCount,
              b: (chunks) => <span className="font-bold text-deck-primary">{chunks}</span>,
              num: (chunks) => <span className="font-bold text-deck-primary tabular-nums">{chunks}</span>,
            })}
          </p>
        )}
      </div>
      <Leaderboard
        entries={leaderboard}
        highlightParticipantId={participantId}
        title={t("leaderboard.finalStandings")}
      />
      {presentationId && <SlotOutlet name="endScreen" props={{ role: "participant", presentationId }} />}
    </div>
  );
}
