"use client";

import "@/features/registrations";

import { useEffect, useEffectEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Play, Radio, RotateCcw, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createLiveStore, LiveStoreProvider, useLive } from "../../live/store";
import { DeckThemeProvider } from "../../theme/DeckThemeProvider";
import { Stage } from "../stage/Stage";
import { HostControls } from "./HostControls";
import { HostHeader } from "./HostHeader";
import { LeaderboardModal } from "./LeaderboardModal";
import { useHostSession } from "./useHostSession";
import { useJoinLink } from "./useJoinLink";

/** Host console = Stage + host controls, over its own live store. */
export function HostConsole({ presentationId }: { presentationId: string }) {
  const [store] = useState(() => createLiveStore("host", { presentationId }));
  return (
    <DeckThemeProvider>
      <LiveStoreProvider store={store}>
        <HostConsoleView presentationId={presentationId} />
      </LiveStoreProvider>
    </DeckThemeProvider>
  );
}

function HostConsoleView({ presentationId }: { presentationId: string }) {
  const router = useRouter();
  const session = useHostSession(presentationId);
  const { loading, loadError, busy, connected, countdown, openLobby, advance, end } = session;

  const status = useLive((s) => s.status);
  const joinCode = useLive((s) => s.joinCode);
  const slideIndex = useLive((s) => s.currentSlideIndex);
  const totalSlides = useLive((s) => s.totalSlides);
  const participantCount = useLive((s) => s.participants.length);
  const hasDeck = useLive((s) => s.deck !== null);
  const join = useJoinLink(joinCode);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Arrow keys / PageUp/PageDown move between slides, F toggles fullscreen.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const isLastSlide = slideIndex >= totalSlides - 1;
    if ((e.key === "ArrowRight" || e.key === "PageDown") && !isLastSlide) {
      void advance(slideIndex + 1);
    } else if ((e.key === "ArrowLeft" || e.key === "PageUp") && slideIndex > 0) {
      void advance(slideIndex - 1);
    } else if (e.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
  });
  useEffect(() => {
    if (status !== "active") return;
    const handleKeyDown = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [status]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deck-stage-bg">
        <Loader2 className="size-8 animate-spin text-deck-primary/60" />
      </div>
    );
  }

  if (loadError || !hasDeck) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-deck-stage-bg px-6 text-center text-deck-stage-fg">
        <p className="text-sm font-semibold text-deck-danger-soft">{loadError ?? "Presentation deck not found."}</p>
        <button
          onClick={() => router.push("/polls")}
          className="text-xs text-deck-stage-fg/40 underline underline-offset-2"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-deck-stage-bg text-deck-stage-fg flex flex-col font-sans overflow-hidden select-none">
      <HostHeader
        presentationId={presentationId}
        busy={busy}
        copiedUrl={join.copiedUrl}
        onCopyUrl={join.copyUrl}
        showLeaderboard={showLeaderboard}
        onToggleLeaderboard={() => setShowLeaderboard((prev) => !prev)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenLobby={() => void openLobby()}
      />

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {!connected && status !== "draft" && status !== "ended" && (
        <div className="flex items-center justify-center gap-2 bg-deck-danger/10 border-b border-deck-danger/20 px-4 py-1.5 text-xs font-semibold text-deck-danger-soft shrink-0">
          <Radio className="size-3 animate-pulse" /> Reconnecting…
        </div>
      )}

      <Stage
        surface="host"
        join={join}
        countdown={countdown}
        lobbyActions={
          status === "draft" ? (
            <Button
              onClick={() => void openLobby()}
              disabled={busy}
              className="h-12 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-8 text-sm shadow-xl shadow-deck-primary/20 hover:opacity-90 transition-all active:scale-[0.98]"
            >
              <Radio className="size-4 mr-2 animate-pulse" /> Open Lobby & Start
            </Button>
          ) : (
            <Button
              onClick={() => void advance()}
              disabled={busy || participantCount === 0}
              className="h-12 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-8 text-sm shadow-xl shadow-deck-primary/20 hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <Play className="size-4 mr-2 fill-current" /> Start <ArrowRight className="size-4 ml-1.5" />
            </Button>
          )
        }
        overlays={
          <button
            onClick={() => setShowLeaderboard(true)}
            title="View Leaderboard"
            className="absolute right-6 bottom-5 z-10 hidden sm:flex items-center gap-2 rounded-full border border-deck-accent/30 bg-deck-accent/10 px-4 py-2 text-xs font-bold text-deck-accent-soft backdrop-blur-md shadow-lg hover:bg-deck-accent/20 transition-all hover:scale-105 active:scale-95"
          >
            <Trophy className="size-4 text-deck-accent" />
            <span>Leaderboard</span>
          </button>
        }
        endActions={
          <>
            <Button
              onClick={() => void openLobby()}
              disabled={busy}
              className="h-10 rounded-full bg-deck-primary text-deck-primary-fg font-bold px-6 text-xs shadow-lg shadow-deck-primary/20 hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="size-4 mr-2" /> Host Again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/polls")}
              className="h-10 rounded-full border-deck-stage-fg/20 text-deck-stage-fg font-semibold px-5 text-xs hover:bg-deck-stage-fg/10"
            >
              Back to Dashboard
            </Button>
          </>
        }
      />

      <HostControls
        busy={busy}
        onAdvance={(target) => void advance(target)}
        onEnd={() => void end()}
        onOpenLobby={() => void openLobby()}
      />
    </div>
  );
}
