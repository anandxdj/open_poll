"use client";

import { useEffect } from "react";

import { useLive, useLiveStore } from "@/features/presentations/live/store";
import type { ParticipantSlotProps } from "@/features/presentations/live/slots";
import type { PresentationRealtimeEvent } from "@/features/presentations/types";
import { acquireSocket, releaseSocket } from "@/lib/socket";
import { rememberQnaTab } from "../tabAvailability";
import { selectQna, useQnaSync } from "../useQnaSync";
import { HostQnaPanel } from "./HostQnaPanel";
import { QnaPanel } from "./QnaPanel";

/** Participant tab body. */
export function QnaTab() {
  return <QnaPanel />;
}

/**
 * Events addressed to one participant (`audience: participant:<id>`, e.g. their
 * own question was rejected) travel only on the versioned `live:event`; the
 * legacy `quiz:event` the live hook listens on carries `all` and `host`
 * audiences only. Until the live hook moves to `live:event`, this bridges the
 * participant-addressed `qna:*` events into the store. Replays are harmless:
 * the reducer upserts.
 */
function usePrivateQnaEvents(presentationId: string, participantId: string) {
  const store = useLiveStore();
  useEffect(() => {
    const socket = acquireSocket();
    const onEvent = (event: PresentationRealtimeEvent) => {
      if (event?.presentationId !== presentationId) return;
      if (event.audience !== `participant:${participantId}` || !event.type.startsWith("qna:")) return;
      store.getState().dispatch({ type: "live/event", event });
    };
    socket.on("live:event", onEvent);
    return () => {
      socket.off("live:event", onEvent);
      releaseSocket();
    };
  }, [store, presentationId, participantId]);
}

/**
 * Invisible: loads the participant's Q&A list as soon as they joined (so the
 * tab, reactions and highlights are ready), follows events addressed to the
 * participant, and tells the tab slot whether Q&A can happen in this deck at all.
 */
export function QnaParticipantSync({ presentationId, participantId }: ParticipantSlotProps) {
  useQnaSync();
  usePrivateQnaEvents(presentationId, participantId);
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
