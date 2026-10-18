"use client";

import "@/features/registrations";

import { useEffect, useState } from "react";
import { Hourglass, Loader2, Presentation as PresentationIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { getPresentationByCode } from "../../api/participant";
import { getSlotEntries, SlotOutlet, type ParticipantSlotProps } from "../../live/slots";
import { createLiveStore, LiveStoreProvider, useLive, useLiveStore } from "../../live/store";
import { useLiveSocket } from "../../live/useLiveSocket";
import { getSlideRuntime } from "../../slides/runtime";
import { DeckThemeProvider } from "../../theme/DeckThemeProvider";
import type { AnswerPayload, PresentationRealtimeEvent } from "../../types";
import { JoinGate } from "./JoinGate";
import { ParticipantEnd } from "./ParticipantEnd";
import { ParticipantSlide } from "./ParticipantSlide";
import { forgetParticipant, readParticipant } from "./participantSession";

/**
 * The participant's live view at `/live/<code>`, over its own live store.
 * The page keys it by code, so a different code remounts it.
 */
export function ParticipantShell({ code }: { code: string }) {
  // Identity persisted per join code. Read once: the first render is the
  // loading spinner either way, so server and client markup still match.
  const [store] = useState(() => createLiveStore("participant", { self: readParticipant(code) }));
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
  const store = useLiveStore();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const status = useLive((s) => s.status);
  const title = useLive((s) => s.title);
  const presentationId = useLive((s) => s.presentationId);
  const self = useLive((s) => s.self);

  useEffect(() => {
    void (async () => {
      try {
        store.getState().dispatch({ type: "participant/info-loaded", info: await getPresentationByCode(code) });
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [code, store]);

  useLiveSocket(
    presentationId,
    self ? { role: "participant", participantId: self.participantId, participantToken: self.token } : undefined,
    (event: PresentationRealtimeEvent) => {
      switch (event.type) {
        case "lobby:opened":
          // The reducer already dropped the identity; drop it from storage
          // too. The device token stays so the rejoin is one identity.
          forgetParticipant(code);
          break;
        case "question:revealed":
        case "leaderboard:shown":
        case "quiz:ended":
          void store.getState().loadMe();
          break;
      }
    }
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-deck-bg text-deck-fg flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-deck-primary/60" />
      </div>
    );
  }

  if (notFound || status === null || !presentationId) {
    return (
      <div className="min-h-screen bg-deck-bg text-deck-fg flex items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <PresentationIcon className="size-10 text-deck-muted-fg/40 mx-auto" />
          <h1 className="text-xl font-bold">{t("notFoundTitle")}</h1>
          <p className="text-sm text-deck-muted-fg">{t("notFoundHint")}</p>
        </div>
      </div>
    );
  }

  if (!self) return <JoinGate code={code} />;

  const slotProps: ParticipantSlotProps = { presentationId, participantId: self.participantId };

  return (
    <div className="min-h-screen bg-deck-bg text-deck-fg flex flex-col font-sans">
      <header className="flex h-14 items-center justify-between border-b border-deck-border/40 px-6 bg-deck-surface/50 backdrop-blur-md">
        <span className="text-xs font-bold truncate max-w-[200px]">{title}</span>
        <span className="text-xs font-semibold text-deck-primary">{self.name}</span>
      </header>

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

  if (status !== "active" || !slide) return null;
  const runtime = getSlideRuntime(slide.type);
  if (!runtime) return null;
  if (runtime.lifecycle === "response") return <ParticipantSlide slide={slide} runtime={runtime} />;
  // Other lifecycles (leaderboard today) render their whole participant view.
  return (
    <runtime.ParticipantView
      slide={slide}
      mode="live"
      onSubmit={(payload: AnswerPayload) => void submitAnswer(payload)}
      submitting={false}
    />
  );
}
