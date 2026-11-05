"use client";

import "@/features/registrations";

import { useEffect, useEffectEvent, useState } from "react";
import { Maximize2, Minimize2, MonitorUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { useJoinLink } from "@/features/presentations/components/host/useJoinLink";
import { Stage } from "@/features/presentations/components/stage/Stage";
import { createLiveStore, LiveStoreProvider, useLive, useLiveStore } from "@/features/presentations/live/store";
import { useCountdown } from "@/features/presentations/live/useCountdown";
import { LiveDeckTheme } from "@/features/themes/LiveDeckTheme";
import { useAudienceMirror } from "../audienceChannel";
import { useSoundCues } from "../soundCues";
import { useFullscreen } from "../useFullscreen";
import { CountdownOverlay } from "./StartCountdown";

/**
 * The audience window at `/presentation/<id>/present` (W2-A): only the stage,
 * for the projector. The presenter view opens it with `window.open` and keeps
 * it in step over a BroadcastChannel (this window has no socket of its own);
 * F or the corner button toggles fullscreen.
 */
export function AudienceWindow({ presentationId }: { presentationId: string }) {
  const [store] = useState(() => createLiveStore("host", { presentationId }));
  return (
    <LiveStoreProvider store={store}>
      <LiveDeckTheme>
        <AudienceScreen presentationId={presentationId} />
      </LiveDeckTheme>
    </LiveStoreProvider>
  );
}

function AudienceScreen({ presentationId }: { presentationId: string }) {
  const t = useTranslations("presenter.audience");
  const store = useLiveStore();
  const { link, ui } = useAudienceMirror(presentationId, store);
  const fullscreen = useFullscreen();
  const joinCode = useLive((s) => s.joinCode);
  const timing = useLive((s) => s.timing);
  const timeLimit = useLive((s) => s.deck?.slides[s.currentSlideIndex]?.timeLimit ?? 30);
  const countdown = useCountdown(timing, timeLimit);
  const join = useJoinLink(joinCode);
  const [hintVisible, setHintVisible] = useState(true);
  useSoundCues(store, ui.sound && link === "live");

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === "f") fullscreen.toggle();
  });
  useEffect(() => {
    const handle = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  // The "Press F" hint fades after a few seconds of a live stage.
  useEffect(() => {
    if (link !== "live") return;
    const timer = setTimeout(() => setHintVisible(false), 4000);
    return () => clearTimeout(timer);
  }, [link]);

  if (link === "waiting") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-deck-stage-bg px-6 text-center text-deck-stage-fg">
        <MonitorUp className="size-10 text-deck-stage-fg/40" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-[-0.03em]">{t("waitingTitle")}</h1>
        <p className="max-w-md text-sm text-deck-stage-fg/60">{t("waitingHint")}</p>
      </div>
    );
  }

  return (
    <div className="group relative flex h-screen flex-col overflow-hidden bg-deck-stage-bg font-sans text-deck-stage-fg" data-testid="audience-stage">
      <Stage surface="screen" join={join} countdown={countdown} />
      <CountdownOverlay secondsLeft={ui.countdown} />

      {link === "closed" && (
        <p role="status" className="absolute inset-x-0 top-0 z-30 bg-deck-stage-panel/95 px-4 py-2 text-center text-sm text-deck-stage-fg/80">
          {t("presenterClosed")}
        </p>
      )}
      {fullscreen.supported && (
        <button
          type="button"
          onClick={fullscreen.toggle}
          aria-label={fullscreen.isFullscreen ? t("exitFullscreen") : t("fullscreen")}
          title={fullscreen.isFullscreen ? t("exitFullscreen") : t("fullscreen")}
          className="absolute right-4 top-4 z-30 inline-flex size-10 items-center justify-center rounded-full border border-deck-stage-fg/15 bg-deck-stage-chrome/80 text-deck-stage-fg opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-deck-accent/50 group-hover:opacity-100"
        >
          {fullscreen.isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      )}
      {fullscreen.supported && !fullscreen.isFullscreen && hintVisible && (
        <p className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-deck-stage-chrome/90 px-4 py-1.5 text-sm text-deck-stage-fg/70">
          {t("fullscreenHint")}
        </p>
      )}
    </div>
  );
}
