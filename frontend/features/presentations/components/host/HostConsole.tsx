"use client";

import "@/features/registrations";

import { useEffect, useEffectEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Radio, RotateCcw, Trophy } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { createLiveStore, LiveStoreProvider, useLive } from "../../live/store";
import { useAfterDelay } from "../../live/useAfterDelay";
import { DeckThemeProvider } from "../../theme/DeckThemeProvider";
import { Stage } from "../stage/Stage";
import { HostControls } from "./HostControls";
import { HostHeader } from "./HostHeader";
import { LeaderboardModal } from "./LeaderboardModal";
import { useHostSession } from "./useHostSession";
import { useJoinLink } from "./useJoinLink";

const primaryButton =
  "rounded-full bg-deck-primary text-deck-primary-fg font-bold shadow-xl shadow-deck-primary/20 hover:opacity-90 transition-all active:scale-[0.98]";
const outlineButton =
  "rounded-full border-deck-stage-fg/20 bg-transparent text-deck-stage-fg font-semibold hover:bg-deck-stage-fg/10";

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
  const t = useTranslations("presenter");
  const router = useRouter();
  const session = useHostSession(presentationId);
  const { loading, loadError, busy, connected, countdown } = session;

  const status = useLive((s) => s.status);
  const joinCode = useLive((s) => s.joinCode);
  const hasDeck = useLive((s) => s.deck !== null);
  const join = useJoinLink(joinCode);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const isLive = status === "lobby" || status === "active";
  const showReconnecting = useAfterDelay(isLive && !connected, 1500);

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

  // Arrow keys / PageUp/PageDown move between slides (both ways), F toggles fullscreen.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      void session.next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      void session.previous();
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
        <p className="text-sm font-semibold text-deck-danger-soft">{loadError ?? t("load.notFound")}</p>
        <button
          onClick={() => router.push("/polls")}
          className="text-xs text-deck-stage-fg/40 underline underline-offset-2"
        >
          {t("load.backToDashboard")}
        </button>
      </div>
    );
  }

  const openLobbyButton = (variant: "outline" | "default" = "outline") => (
    <Button
      variant={variant}
      onClick={() => void session.openLobby()}
      disabled={busy}
      className={`h-12 px-8 text-sm ${variant === "outline" ? outlineButton : primaryButton}`}
    >
      <Radio className="size-4 mr-2" /> {t("ready.openLobby")}
    </Button>
  );

  return (
    <div className="h-screen bg-deck-stage-bg text-deck-stage-fg flex flex-col font-sans overflow-hidden select-none">
      <HostHeader
        presentationId={presentationId}
        copiedUrl={join.copiedUrl}
        onCopyUrl={join.copyUrl}
        showLeaderboard={showLeaderboard}
        onToggleLeaderboard={() => setShowLeaderboard((prev) => !prev)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {showReconnecting && (
        <div className="flex items-center justify-center gap-2 bg-deck-danger/10 border-b border-deck-danger/20 px-4 py-1.5 text-xs font-semibold text-deck-danger-soft shrink-0">
          <Radio className="size-3 animate-pulse" /> {t("connection.reconnecting")}
        </div>
      )}

      <Stage
        surface="host"
        join={join}
        countdown={countdown}
        readyActions={
          <>
            <Button onClick={() => void session.start()} disabled={busy} className={`h-12 px-8 text-sm ${primaryButton}`}>
              <Play className="size-4 mr-2 fill-current" /> {t("ready.start")}
            </Button>
            {openLobbyButton()}
          </>
        }
        lobbyActions={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={() => void session.start()} disabled={busy} className={`h-12 px-8 text-sm ${primaryButton}`}>
              <Play className="size-4 mr-2 fill-current" /> {t("lobby.start")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void session.end()}
              disabled={busy}
              className={`h-12 px-6 text-sm ${outlineButton}`}
            >
              {t("lobby.end")}
            </Button>
          </div>
        }
        overlays={
          <button
            onClick={() => setShowLeaderboard(true)}
            title={t("header.leaderboard")}
            className="absolute right-6 bottom-5 z-10 hidden sm:flex items-center gap-2 rounded-full border border-deck-accent/30 bg-deck-accent/10 px-4 py-2 text-xs font-bold text-deck-accent-soft backdrop-blur-md shadow-lg hover:bg-deck-accent/20 transition-all hover:scale-105 active:scale-95"
          >
            <Trophy className="size-4 text-deck-accent" />
            <span>{t("header.leaderboard")}</span>
          </button>
        }
        endActions={
          <>
            <Button
              onClick={() => void session.start()}
              disabled={busy}
              className="h-10 px-6 text-xs rounded-full bg-deck-primary text-deck-primary-fg font-bold shadow-lg shadow-deck-primary/20 hover:opacity-90 transition-opacity"
            >
              <RotateCcw className="size-4 mr-2" /> {t("end.presentAgain")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void session.openLobby()}
              disabled={busy}
              className={`h-10 px-5 text-xs ${outlineButton}`}
            >
              {t("end.openLobby")}
            </Button>
            <Button variant="outline" onClick={() => router.push("/polls")} className={`h-10 px-5 text-xs ${outlineButton}`}>
              {t("end.backToDashboard")}
            </Button>
          </>
        }
      />

      <HostControls
        busy={busy}
        onPrevious={() => void session.previous()}
        onNext={() => void session.next()}
        onCloseVoting={() => void session.closeVoting()}
        onReopenVoting={() => void session.reopenVoting()}
        onReveal={() => void session.reveal()}
        onEnd={() => void session.end()}
      />
    </div>
  );
}
