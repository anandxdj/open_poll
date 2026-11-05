"use client";

import { useEffect } from "react";

import { useLive } from "@/features/presentations/live/store";
import type { ParticipantSlotProps } from "@/features/presentations/live/slots";
import { rememberQnaTab } from "../tabAvailability";
import { selectQna, useQnaSync } from "../useQnaSync";
import { HostQnaPanel } from "./HostQnaPanel";
import { QnaPanel } from "./QnaPanel";

/** Participant tab body. */
export function QnaTab() {
  return <QnaPanel />;
}

/**
 * Invisible: loads the participant's Q&A list as soon as they joined (so the
 * tab, reactions and highlights are ready) and tells the tab slot whether Q&A
 * can happen in this deck at all. Events addressed to the participant
 * (`audience: participant:<id>`, e.g. their own question was rejected) arrive
 * through the live socket hook like every other `live:event` (the bridge that
 * used to forward them while the hook listened to the legacy `quiz:event` is gone).
 */
export function QnaParticipantSync({ presentationId }: ParticipantSlotProps) {
  useQnaSync();
  const available = useLive((s) => {
    const { loaded, settings } = selectQna(s);
    return loaded && settings ? settings.enabled || settings.hasBoard : null;
  });
  useEffect(() => {
    if (available !== null) rememberQnaTab(presentationId, available);
  }, [available, presentationId]);
  return null;
}

/** The moderation panel inside the presenter console's `presenterPanels` area (rendered by W2-A's console). */
export function PresenterQnaPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-deck-stage-fg/10 bg-deck-stage-fg/[0.03] p-3 text-deck-stage-fg">
      <HostQnaPanel className="flex-1" />
    </div>
  );
}
