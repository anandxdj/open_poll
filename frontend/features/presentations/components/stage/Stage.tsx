"use client";

import type { ReactNode } from "react";
import { useLive } from "../../live/store";
import { SlotOutlet, type StageSlotProps } from "../../live/slots";
import { ResponseCounter } from "./ResponseCounter";
import { StageEnd } from "./StageEnd";
import { StageLobby, type JoinLinkControls } from "./StageLobby";
import { StageSlide, type StageCountdown } from "./StageSlide";

interface StageProps {
  surface: StageSlotProps["surface"];
  join: JoinLinkControls;
  countdown: StageCountdown;
  /** Under the lobby's participant list (host: open lobby / start). */
  lobbyActions?: ReactNode;
  /** On the end screen (host: host again / back to dashboard). */
  endActions?: ReactNode;
  /** Extra layers over a running slide (host: leaderboard button). */
  overlays?: ReactNode;
}

/**
 * What the audience sees on the projected screen: lobby, the running slide,
 * the end screen. Reads the surrounding live store; controls come in as
 * props so the same stage can run without them on an audience-only screen.
 */
export function Stage({ surface, join, countdown, lobbyActions, endActions, overlays }: StageProps) {
  const status = useLive((s) => s.status);
  const presentationId = useLive((s) => s.presentationId);
  const slide = useLive((s) => s.deck?.slides[s.deck.currentSlideIndex] ?? null);

  return (
    <main className="relative flex-1 overflow-hidden flex flex-col items-center justify-center p-4 sm:p-6">
      {(status === "lobby" || status === "draft") && <StageLobby join={join} actions={lobbyActions} />}

      {status === "active" && slide && (
        <>
          <ResponseCounter />
          {overlays}
          <StageSlide slide={slide} countdown={countdown} />
        </>
      )}

      {status === "ended" && <StageEnd actions={endActions} />}

      {presentationId && <SlotOutlet name="stageOverlays" props={{ surface, presentationId }} />}
    </main>
  );
}
