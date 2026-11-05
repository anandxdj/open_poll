"use client";

import type { ReactNode } from "react";
import { useLive } from "../../live/store";
import { useDeckTheme } from "../../theme/DeckThemeProvider";
import { SlotOutlet, type StageSlotProps } from "../../live/slots";
import { getSlideRuntime } from "../../slides/runtime";
import { ResponseCounter } from "./ResponseCounter";
import { StageEnd } from "./StageEnd";
import { StageLobby, type JoinLinkControls } from "./StageLobby";
import { StageReady } from "./StageReady";
import { StageSlide, type StageCountdown } from "./StageSlide";

interface StageProps {
  surface: StageSlotProps["surface"];
  join: JoinLinkControls;
  countdown: StageCountdown;
  /** Before the first run, nothing open (host: start presenting / open lobby). */
  readyActions?: ReactNode;
  /** Under the lobby's participant list (host: start). */
  lobbyActions?: ReactNode;
  /** On the end screen (host: present again / open lobby / back to dashboard). */
  endActions?: ReactNode;
  /** Extra layers over a running slide (host: leaderboard button). */
  overlays?: ReactNode;
}

/**
 * What the audience sees on the projected screen: the not-yet-started state,
 * lobby, the running slide, the end screen. Reads the surrounding live store;
 * controls come in as props so the same stage can run without them on an
 * audience-only screen.
 */
export function Stage({ surface, join, countdown, readyActions, lobbyActions, endActions, overlays }: StageProps) {
  const status = useLive((s) => s.status);
  const presentationId = useLive((s) => s.presentationId);
  const slide = useLive((s) => s.deck?.slides[s.currentSlideIndex] ?? null);
  const background = useDeckTheme()?.background ?? null;
  const overlay = background
    ? `color-mix(in srgb, var(--deck-stage-bg) ${Math.round(background.overlayOpacity * 100)}%, transparent)`
    : "";

  return (
    <main className="relative flex-1 overflow-hidden flex flex-col items-center justify-center p-4 sm:p-6">
      {/* A brand kit's background picture, under the stage colour at the kit's overlay strength. */}
      {background ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `linear-gradient(${overlay}, ${overlay}), url(${JSON.stringify(background.imageUrl)})`,
          }}
        />
      ) : null}
      {/* Graph paper behind everything but a running slide, which needs the room's full attention. */}
      {status !== "active" && <div aria-hidden="true" className="stage-grid pointer-events-none absolute inset-0" />}
      {status === "draft" && <StageReady actions={readyActions} />}


      {status === "lobby" && <StageLobby join={join} actions={lobbyActions} />}

      {status === "active" && slide && (
        <>
          {getSlideRuntime(slide.type)?.lifecycle === "response" && <ResponseCounter />}
          {overlays}
          <StageSlide slide={slide} countdown={countdown} />
        </>
      )}

      {status === "ended" && <StageEnd actions={endActions} />}

      {presentationId && <SlotOutlet name="stageOverlays" props={{ surface, presentationId }} />}
    </main>
  );
}
