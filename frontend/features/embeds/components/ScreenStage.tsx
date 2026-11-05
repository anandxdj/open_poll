"use client";

import "@/features/registrations";

import { useState } from "react";
import { Loader2, Radio, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { createLiveStore, LiveStoreProvider, useLive } from "@/features/presentations/live/store";
import { useAfterDelay } from "@/features/presentations/live/useAfterDelay";
import { Stage } from "@/features/presentations/components/stage/Stage";
import { useJoinLink } from "@/features/presentations/components/host/useJoinLink";
import { LiveDeckTheme } from "@/features/themes/LiveDeckTheme";
import { EmbedNotice } from "./EmbedNotice";
import { useScreenSession } from "./useScreenSession";

/**
 * A deck's stage, read-only, for a room screen, a web page or an add-in pane
 * (W4-D): what the host console's stage shows, with no controls, joined with a
 * screen token. Its live store is a host store (the state has the host's
 * shape), but nothing here can send a host command.
 */
export function ScreenStage({ presentationId, screenToken }: { presentationId: string; screenToken: string }) {
  const [store] = useState(() => createLiveStore("host", { presentationId }));
  return (
    <LiveStoreProvider store={store}>
      <LiveDeckTheme>
        <ScreenStageView presentationId={presentationId} screenToken={screenToken} />
      </LiveDeckTheme>
    </LiveStoreProvider>
  );
}

function ScreenStageView({ presentationId, screenToken }: { presentationId: string; screenToken: string }) {
  const t = useTranslations("embeds.screen");
  const { loading, problem, connected, countdown, retry } = useScreenSession(presentationId, screenToken);
  const status = useLive((s) => s.status);
  const joinCode = useLive((s) => s.joinCode);
  const hasDeck = useLive((s) => s.deck !== null);
  const join = useJoinLink(joinCode);
  const isLive = status === "lobby" || status === "active";
  const showReconnecting = useAfterDelay(isLive && !connected && problem === null, 1500);

  if (problem === "notFound" || problem === "disabled") return <EmbedNotice kind={problem} />;
  if (problem === "revoked") {
    return (
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-2 bg-deck-stage-bg px-6 text-center text-deck-stage-fg">
        <p className="text-lg font-semibold tracking-[-0.02em]">{t("revokedTitle")}</p>
        <p className="text-sm text-deck-stage-fg/70">{t("revokedHint")}</p>
      </div>
    );
  }
  if (loading || (!hasDeck && problem === null)) {
    return (
      <div className="flex flex-1 items-center justify-center bg-deck-stage-bg" role="status" aria-label={t("loading")}>
        <Loader2 className="size-8 animate-spin text-deck-stage-fg/50" />
      </div>
    );
  }
  if (!hasDeck) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-deck-stage-bg px-6 text-center text-deck-stage-fg">
        <p className="text-sm font-semibold text-deck-danger-soft">{t("loadFailed")}</p>
        <button
          type="button"
          onClick={() => void retry()}
          className="inline-flex items-center gap-2 rounded-full border border-deck-stage-fg/20 px-4 py-2 text-sm hover:bg-deck-stage-fg/10"
        >
          <RefreshCw className="size-4" /> {t("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-deck-stage-bg font-sans text-deck-stage-fg select-none" data-testid="screen-stage">
      {showReconnecting && (
        <div role="status" className="flex shrink-0 items-center justify-center gap-2 border-b border-deck-stage-fg/10 px-4 py-1.5 text-xs font-semibold text-deck-stage-fg/70">
          <Radio className="size-3 animate-pulse" /> {t("reconnecting")}
        </div>
      )}
      <Stage surface="screen" join={join} countdown={countdown} />
    </div>
  );
}
