"use client";

import "@/features/registrations";

import { useState } from "react";
import { Hourglass, Loader2, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

import { getSlotEntries, SlotOutlet, type ParticipantSlotProps } from "../../live/slots";
import { createLiveStore, LiveStoreProvider, useLive } from "../../live/store";
import { useAfterDelay } from "../../live/useAfterDelay";
import { getSlideRuntime } from "../../slides/runtime";
import { DeckThemeProvider } from "../../theme/DeckThemeProvider";
import type { AnswerPayload } from "../../types";
import { JoinGate } from "./JoinGate";
import { ParticipantEnd } from "./ParticipantEnd";
import {
  NewSessionNotice,
  ParticipantKicked,
  ParticipantNotFound,
  ParticipantSessionClosed,
} from "./ParticipantNotices";
import { ParticipantSlide } from "./ParticipantSlide";
import { useParticipantSession } from "./useParticipantSession";

/**
 * The participant's live view at `/live/<code>`, over its own live store.
 * The page keys it by code, so a different code remounts it.
 */
export function ParticipantShell({ code }: { code: string }) {
  const [store] = useState(() => createLiveStore("participant"));
  return (
    <DeckThemeProvider>
      <LiveStoreProvider store={store}>
        <ParticipantScreen code={code} />
      </LiveStoreProvider>
    </DeckThemeProvider>
  );
}

function ParticipantScreen({ code }: { code: string }) {
  const t = useTranslations("live.participant");
  const { load, self, lost, rejoin, newerSessionId, joinNewerSession } = useParticipantSession(code);

  const status = useLive((s) => s.status);
  const title = useLive((s) => s.title);
  const presentationId = useLive((s) => s.presentationId);
  const connected = useLive((s) => s.connected);
  const showReconnecting = useAfterDelay(!connected && status !== "ended", 1500);

  if (load === "loading") {
    return (
      <div className="min-h-screen bg-deck-bg text-deck-fg flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-deck-primary/60" />
      </div>
    );
  }

  if (load === "not-found" || status === null || !presentationId) return <ParticipantNotFound />;
  if (lost === "kicked") return <ParticipantKicked />;

  if (!self) {
    // Only a live session can be joined; an ended one without our standings is just over.
    if (status === "lobby" || status === "active") return <JoinGate code={code} rejoin={rejoin} />;
    return <ParticipantSessionClosed />;
  }

  const slotProps: ParticipantSlotProps = { presentationId, participantId: self.participantId };

  return (
    <div className="min-h-screen bg-deck-bg text-deck-fg flex flex-col font-sans">
      <header className="flex h-14 items-center justify-between border-b border-deck-border/40 px-6 bg-deck-surface/50 backdrop-blur-md">
        <span className="text-xs font-bold truncate max-w-[200px]">{title}</span>
        <span className="text-xs font-semibold text-deck-primary">{self.name}</span>
      </header>

      {showReconnecting && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-deck-border/40 bg-deck-surface/60 px-4 py-1.5 text-xs font-semibold text-deck-muted-fg"
        >
          <Radio className="size-3 animate-pulse" /> {t("reconnecting")}
        </div>
      )}
      {status === "ended" && newerSessionId && <NewSessionNotice onJoin={() => void joinNewerSession()} />}

      <SlotOutlet name="participantBanner" props={slotProps} />

      <ParticipantMain slotProps={slotProps} />

      <SlotOutlet name="participantFooter" props={slotProps} />
    </div>
  );
}

/** Tab bar (only once a module registers a participant tab) and the active tab's body. */
function ParticipantMain({ slotProps }: { slotProps: ParticipantSlotProps }) {
  const t = useTranslations("live.participant");
  const [activeTab, setActiveTab] = useState("slide");
  const tabs = getSlotEntries("participantTabs", slotProps);
  const tab = tabs.find((entry) => entry.id === activeTab);

  return (
    <>
      {tabs.length > 0 && (
        <nav className="flex justify-center gap-1 border-b border-deck-border/40 px-6 py-2" aria-label="Sections">
          {[{ id: "slide", label: t("slideTab") }, ...tabs].map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setActiveTab(entry.id)}
              aria-current={(tab?.id ?? "slide") === entry.id ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                (tab?.id ?? "slide") === entry.id
                  ? "bg-deck-primary/15 text-deck-primary"
                  : "text-deck-muted-fg hover:text-deck-fg"
              }`}
            >
              {entry.label ?? entry.id}
            </button>
          ))}
        </nav>
      )}

      <main className="flex-1 flex flex-col justify-center items-center p-6 max-w-md mx-auto w-full">
        {tab ? <tab.Component {...slotProps} /> : <ParticipantBody slotProps={slotProps} />}
      </main>
    </>
  );
}

/** The slide tab: lobby, the slide on screen, or the end screen — unless a module overrides it. */
function ParticipantBody({ slotProps }: { slotProps: ParticipantSlotProps }) {
  const t = useTranslations("live.participant");
  const status = useLive((s) => s.status);
  const slide = useLive((s) => s.slide);
  const submitAnswer = useLive((s) => s.submitAnswer);

  const [override] = getSlotEntries("participantBody", slotProps);
  if (override) return <override.Component {...slotProps} />;

  if (status === "lobby") {
    return (
      <div className="text-center space-y-4">
        <Hourglass className="size-10 text-deck-primary animate-spin mx-auto" />
        <h2 className="text-xl font-bold">{t("lobbyTitle")}</h2>
        <p className="text-sm text-deck-muted-fg">{t("lobbyHint")}</p>
      </div>
    );
  }

  if (status === "ended") return <ParticipantEnd />;

  if (status !== "active") return null;
  const runtime = slide ? getSlideRuntime(slide.type) : undefined;
  if (!slide || !runtime) {
    // Joined, but the live slide has not arrived yet (the `live-state` read is in flight).
    return (
      <div className="text-center space-y-3 text-deck-muted-fg">
        <Loader2 className="size-6 animate-spin mx-auto" />
        <p className="text-xs">{t("waitingForSlide")}</p>
      </div>
    );
  }
  if (runtime.lifecycle === "response") return <ParticipantSlide slide={slide} runtime={runtime} />;
  // Other lifecycles render their whole participant view: content and board
  // slides show "Look at the screen", the leaderboard shows the standings.
  return (
    <runtime.ParticipantView
      slide={slide}
      mode="live"
      onSubmit={(payload: AnswerPayload) => void submitAnswer(payload)}
      submitting={false}
    />
  );
}
