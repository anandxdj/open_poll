"use client";

import "@/features/registrations";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  Check,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorUp,
  Play,
  Radio,
  RotateCcw,
  Timer as TimerIcon,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { EndSessionDialog } from "@/features/presentations/components/host/EndSessionDialog";
import { useHostSession } from "@/features/presentations/components/host/useHostSession";
import { useJoinLink } from "@/features/presentations/components/host/useJoinLink";
import { Stage } from "@/features/presentations/components/stage/Stage";
import { SlotOutlet } from "@/features/presentations/live/slots";
import { createLiveStore, LiveStoreProvider, useLive, useLiveStore } from "@/features/presentations/live/store";
import { useAfterDelay } from "@/features/presentations/live/useAfterDelay";
import { LiveDeckTheme } from "@/features/themes/LiveDeckTheme";
import { useAudienceBroadcast, type AudienceUi } from "../audienceChannel";
import { useSoundCues, useSoundPreference } from "../soundCues";
import { useFullscreen } from "../useFullscreen";
import { CountdownOverlay, useStartCountdown } from "./StartCountdown";
import { NextSlidePreview } from "./NextSlidePreview";
import { NotesPanel } from "./NotesPanel";
import { ParticipantList } from "./ParticipantList";
import { PresenterControls } from "./PresenterControls";
import { RemotePairing } from "./RemotePairing";
import { ResponseCounter } from "./ResponseCounter";
import { SessionClock } from "./SessionClock";

const primaryButton =
  "rounded-full bg-deck-accent font-semibold text-deck-stage-ink transition-colors hover:bg-deck-accent-soft";
const outlineButton =
  "rounded-full border-deck-stage-fg/20 bg-transparent font-medium text-deck-stage-fg hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg";
const pill =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-deck-stage-fg/15 px-3 text-sm font-medium text-deck-stage-fg transition-colors hover:bg-deck-stage-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50";
const panel = "rounded-xl border border-deck-stage-fg/10 bg-deck-stage-chrome p-4";

/** The audience window's path and the name `window.open` reuses (one window per deck). */
export const audienceWindowPath = (presentationId: string) => `/presentation/${presentationId}/present`;
const audienceWindowName = (presentationId: string) => `openpoll-audience-${presentationId}`;

/**
 * Presenter view at `/presentation/<id>/presenter` (W2-A), over its own host
 * live store: the slide on screen, the next slide, speaker notes, the session
 * clock, responses, the participants (with Remove), every control (slides,
 * voting, timer), the phone-remote pairing, and the audience window it keeps in
 * step over a BroadcastChannel.
 */
export function PresenterConsole({ presentationId }: { presentationId: string }) {
  const [store] = useState(() => createLiveStore("host", { presentationId }));
  return (
    <LiveStoreProvider store={store}>
      <LiveDeckTheme>
        <PresenterView presentationId={presentationId} />
      </LiveDeckTheme>
    </LiveStoreProvider>
  );
}

function PresenterView({ presentationId }: { presentationId: string }) {
  const t = useTranslations("presenter");
  const router = useRouter();
  const store = useLiveStore();
  const session = useHostSession(presentationId);
  const { loading, loadError, busy, connected, countdown } = session;
  const fullscreen = useFullscreen();

  const status = useLive((s) => s.status);
  const title = useLive((s) => s.title);
  const joinCode = useLive((s) => s.joinCode);
  const hasDeck = useLive((s) => s.deck !== null);
  const participantCount = useLive((s) => s.participants.length);
  const join = useJoinLink(joinCode);
  const isLive = status === "lobby" || status === "active";
  const showReconnecting = useAfterDelay(isLive && !connected, 1500);

  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [sound, setSound] = useSoundPreference();
  const [withCountdown, setWithCountdown] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const audienceRef = useRef<Window | null>(null);

  const start = useStartCountdown(session.start);
  const ui = useMemo<AudienceUi>(() => ({ sound, countdown: start.secondsLeft }), [sound, start.secondsLeft]);
  const { audienceSeen } = useAudienceBroadcast(presentationId, store, ui);
  // Cues play where the speakers are: the audience window when one is open, else here.
  useSoundCues(store, sound && !audienceSeen);

  const toggleSound = () => setSound(!sound);

  const openAudienceWindow = useCallback(() => {
    const existing = audienceRef.current;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const opened = window.open(audienceWindowPath(presentationId), audienceWindowName(presentationId), "popup,width=1280,height=720");
    audienceRef.current = opened;
    setPopupBlocked(!opened);
  }, [presentationId]);

  const begin = () => (withCountdown ? start.run() : void session.start());

  // ←/→ and PageUp/PageDown move between slides while presenting; F toggles fullscreen.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (confirmingEnd || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('[role="alertdialog"]')) return;
    if (status === "active" && (e.key === "ArrowRight" || e.key === "PageDown")) void session.next();
    else if (status === "active" && (e.key === "ArrowLeft" || e.key === "PageUp")) void session.previous();
    else if (e.key.toLowerCase() === "f") fullscreen.toggle();
  });
  useEffect(() => {
    const handle = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deck-stage-bg">
        <Loader2 className="size-8 animate-spin text-deck-stage-fg/50" />
      </div>
    );
  }

  if (loadError || !hasDeck) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-deck-stage-bg px-6 text-center text-deck-stage-fg">
        <p className="text-sm font-semibold text-deck-danger-soft">{loadError ?? t("load.notFound")}</p>
        <button
          onClick={() => router.push("/polls")}
          className="text-sm text-deck-stage-fg/70 underline underline-offset-4 hover:text-deck-stage-fg"
        >
          {t("load.backToDashboard")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-deck-stage-bg font-sans text-deck-stage-fg lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-deck-stage-fg/10 bg-deck-stage-chrome px-5 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex shrink-0 items-center gap-2 rounded-full border border-deck-stage-fg/15 px-2.5 py-1 text-xs font-medium">
            {isLive && <span className="size-1.5 rounded-full bg-deck-live motion-safe:animate-pulse" aria-hidden="true" />}
            {t("console.badge")}
          </span>
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isLive && (
            <>
              <span className="flex items-center gap-1.5 text-sm text-deck-stage-fg/70" title={t("header.joined", { count: participantCount })}>
                <Users className="size-4" aria-hidden="true" /> <span className="font-mono tabular-nums">{participantCount}</span>
              </span>
              <button type="button" onClick={join.copyUrl} title={t("header.copyJoinLink")} className={`${pill} font-mono tracking-[0.12em]`}>
                {joinCode}
                {join.copiedUrl ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5 opacity-60" aria-hidden="true" />}
              </button>
            </>
          )}
          <button type="button" onClick={openAudienceWindow} className={pill} title={t("console.audienceHint")}>
            <MonitorUp className="size-4" aria-hidden="true" />
            {audienceSeen ? t("console.audienceOpen") : t("console.openAudience")}
          </button>
          <button type="button" onClick={toggleSound} aria-pressed={sound} title={t("console.soundLabel")} className={pill}>
            {sound ? <Bell className="size-4" aria-hidden="true" /> : <BellOff className="size-4" aria-hidden="true" />}
            <span className="hidden sm:inline">{sound ? t("console.soundOn") : t("console.soundOff")}</span>
          </button>
          <Link href={`/presentation/host/${presentationId}`} className={pill} title={t("console.simpleViewHint")}>
            {t("console.simpleView")}
          </Link>
          {fullscreen.supported && (
            <button
              type="button"
              onClick={fullscreen.toggle}
              title={t("header.toggleFullscreen")}
              aria-label={t("header.toggleFullscreen")}
              className={`${pill} px-2`}
            >
              {fullscreen.isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          )}
        </div>
      </header>

      {showReconnecting && (
        <div role="status" className="flex shrink-0 items-center justify-center gap-2 border-b border-deck-danger/20 bg-deck-danger/10 px-4 py-1.5 text-xs font-semibold text-deck-danger-soft">
          <Radio className="size-3 animate-pulse" /> {t("connection.reconnecting")}
        </div>
      )}
      {popupBlocked && (
        <div role="alert" className="shrink-0 border-b border-deck-stage-fg/10 bg-deck-stage-panel px-4 py-2 text-center text-sm">
          {t("console.audienceBlocked")}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col gap-3">
          <h2 className="sr-only">{t("console.currentSlide")}</h2>
          <div
            data-testid="presenter-current-slide"
            className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-deck-stage-fg/10"
          >
            <Stage
              surface="host"
              join={join}
              countdown={countdown}
              readyActions={
                <>
                  <Button onClick={begin} disabled={busy || start.running} className={`h-12 px-8 text-sm ${primaryButton}`}>
                    <Play className="mr-2 size-4 fill-current" /> {t("ready.start")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void session.openLobby()}
                    disabled={busy}
                    className={`h-12 px-8 text-sm ${outlineButton}`}
                  >
                    <Radio className="mr-2 size-4" /> {t("ready.openLobby")}
                  </Button>
                </>
              }
              lobbyActions={
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button onClick={begin} disabled={busy || start.running} className={`h-12 px-8 text-sm ${primaryButton}`}>
                    <Play className="mr-2 size-4 fill-current" /> {t("lobby.start")}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmingEnd(true)} disabled={busy} className={`h-12 px-6 text-sm ${outlineButton}`}>
                    {t("lobby.end")}
                  </Button>
                </div>
              }
              endActions={
                <>
                  <Button onClick={begin} disabled={busy || start.running} className={`h-11 px-6 text-sm ${primaryButton}`}>
                    <RotateCcw className="mr-2 size-4" /> {t("end.presentAgain")}
                  </Button>
                  <Button variant="outline" onClick={() => void session.openLobby()} disabled={busy} className={`h-11 px-5 text-sm ${outlineButton}`}>
                    {t("end.openLobby")}
                  </Button>
                </>
              }
            />
            <CountdownOverlay secondsLeft={start.secondsLeft} />
          </div>
          {status !== "active" && status !== "ended" && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-deck-stage-fg/70">
              <input
                type="checkbox"
                checked={withCountdown}
                onChange={(e) => setWithCountdown(e.target.checked)}
                className="size-4 accent-[var(--deck-accent)]"
              />
              <TimerIcon className="size-4" aria-hidden="true" /> {t("console.countdownToggle")}
            </label>
          )}
          <div className={panel}>
            <PresenterControls session={session} onEnd={() => setConfirmingEnd(true)} />
            {status !== "active" && <SessionClock />}
          </div>
        </div>

        <aside className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto">
          <div className={`${panel} space-y-4`}>
            {status === "active" && <SessionClock />}
            <ResponseCounter />
          </div>
          <div className={panel}>
            <NotesPanel />
          </div>
          <div className={panel}>
            <NextSlidePreview />
          </div>
          <div className={panel}>
            <ParticipantList onKick={session.kick} />
          </div>
          <div className={panel}>
            <RemotePairing presentationId={presentationId} />
          </div>
          <SlotOutlet name="presenterPanels" props={{ presentationId }} />
        </aside>
      </div>

      <EndSessionDialog open={confirmingEnd} onOpenChange={setConfirmingEnd} onConfirm={() => void session.end()} />
    </div>
  );
}
