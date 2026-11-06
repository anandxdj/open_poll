"use client";

import "@/features/registrations";

import { useRef, useState } from "react";
import { Hourglass, Loader2, Radio } from "lucide-react";
import { useTranslations } from "next-intl";

import { LiveAnnouncer, useAnnounceOnChange, useFocusHeadingOnChange } from "@/components/a11y/live-announcer";
import { getSlotEntries, SlotOutlet, type ParticipantSlotProps } from "../../live/slots";
import { createLiveStore, LiveStoreProvider, useLive } from "../../live/store";
import { useAfterDelay } from "../../live/useAfterDelay";
import { getSlideRuntime } from "../../slides/runtime";
import { LiveDeckTheme } from "@/features/themes/LiveDeckTheme";
import { useDeckTheme } from "../../theme/DeckThemeProvider";
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
import { AudienceRun } from "./audience/AudienceRun";
import { audienceSliceOf } from "./audience/audienceSlice";
import { useAnswerSyncNotices } from "./useAnswerSyncNotices";
import { useParticipantSession } from "./useParticipantSession";

/**
 * The participant's live view at `/live/<code>`, over its own live store.
 * The page keys it by code, so a different code remounts it.
 */
export function ParticipantShell({ code }: { code: string }) {
  const [store] = useState(() => createLiveStore("participant"));
  return (
    <LiveStoreProvider store={store}>
      <LiveDeckTheme>
        {/* Screen-reader announcements of the whole phone (W4-A): new slide, answer outcome, results. */}
        <LiveAnnouncer>
          <ParticipantScreen code={code} />
        </LiveAnnouncer>
      </LiveDeckTheme>
    </LiveStoreProvider>
  );
}

function ParticipantScreen({ code }: { code: string }) {
  const t = useTranslations("live.participant");
  const { load, self, lost, rejoin, newerSessionId, joinNewerSession } = useParticipantSession(code);
  useAnswerSyncNotices();

  const status = useLive((s) => s.status);
  const title = useLive((s) => s.title);
  const theme = useDeckTheme();
  const presentationId = useLive((s) => s.presentationId);
  const connected = useLive((s) => s.connected);
  const showReconnecting = useAfterDelay(!connected && status !== "ended", 1500);

  if (load === "loading") {
    return (
      <div className="min-h-screen bg-deck-bg text-deck-fg flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-deck-primary-ink" aria-hidden="true" />
        <p className="sr-only" role="status">{t("syncing")}</p>
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
      <header className="flex h-14 items-center justify-between border-b border-deck-border bg-deck-bg px-5">
        <span className="flex min-w-0 items-center gap-2.5">
          {theme?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a customer's logo from their brand kit, any host
            <img src={theme.logo.url} alt={theme.logo.alt} className="h-7 max-w-[96px] shrink-0 object-contain" />
          ) : null}
          <h1 className="max-w-[200px] truncate text-sm font-semibold tracking-[-0.01em]">{title}</h1>
        </span>
        <span className="flex items-center gap-1.5 text-sm text-deck-muted-fg"><span className="size-1.5 rounded-full bg-deck-live" aria-hidden="true" />{self.name}</span>
      </header>

      {showReconnecting && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-deck-border bg-deck-surface px-4 py-1.5 text-sm text-deck-muted-fg"
        >
          <Radio className="size-3 animate-pulse" aria-hidden="true" /> {t("reconnecting")}
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
  const tAll = useTranslations();
  const [activeTab, setActiveTab] = useState("slide");
  const tabs = getSlotEntries("participantTabs", slotProps);
  const tab = tabs.find((entry) => entry.id === activeTab);

  // A new screen on the slide tab (lobby, each slide, the end) or another tab: focus moves to its
  // heading, so a keyboard or screen-reader user starts there (W4-A). Audience pace moves within its own run.
  const mainRef = useRef<HTMLElement>(null);
  const status = useLive((s) => s.status);
  const slideKey = useLive((s) => (s.slide ? `${s.slideId ?? ""}:${s.slide.slideIndex}` : ""));
  const audiencePaced = useLive((s) => audienceSliceOf(s).pace === "audience");
  const screenKey = tab ? `tab:${tab.id}` : status === "active" && !audiencePaced ? `slide:${slideKey}` : `status:${status}`;
  useFocusHeadingOnChange(mainRef, screenKey, { initial: true });

  return (
    <>
      {tabs.length > 0 && (
        <nav className="flex justify-center gap-1 border-b border-deck-border px-6 py-1.5" aria-label={t("sectionsNav")}>
          {[{ id: "slide", label: t("slideTab"), labelKey: undefined as string | undefined }, ...tabs].map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setActiveTab(entry.id)}
              aria-current={(tab?.id ?? "slide") === entry.id ? "page" : undefined}
              // 44 px tall on a phone (W4-A).
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors ${
                (tab?.id ?? "slide") === entry.id
                  ? "bg-deck-primary/15 text-deck-primary-ink"
                  : "text-deck-muted-fg hover:text-deck-fg"
              }`}
            >
              {/* A module's tab names its message key; the key itself is never shown. */}
              {entry.labelKey && tAll.has(entry.labelKey as never) ? tAll(entry.labelKey as never) : (entry.label ?? entry.id)}
            </button>
          ))}
        </nav>
      )}

      <main ref={mainRef} className="flex-1 flex flex-col justify-center items-center p-6 max-w-md mx-auto w-full">
        {tab ? <tab.Component {...slotProps} /> : <ParticipantBody slotProps={slotProps} />}
      </main>
    </>
  );
}

/** The slide tab: lobby, the slide on screen, or the end screen — unless a module overrides it. */
function ParticipantBody({ slotProps }: { slotProps: ParticipantSlotProps }) {
  const t = useTranslations("live.participant");
  const tAnnounce = useTranslations("live.announce");
  const status = useLive((s) => s.status);
  const slide = useLive((s) => s.slide);
  const submitAnswer = useLive((s) => s.submitAnswer);
  const audiencePaced = useLive((s) => audienceSliceOf(s).pace === "audience");

  // A new slide is announced by its position; focus lands on its heading (ParticipantMain).
  useAnnounceOnChange(
    status === "active" && slide && !audiencePaced ? `${slide.slideIndex}:${slide.type}` : null,
    slide ? tAnnounce("slide", { current: slide.slideIndex + 1, total: slide.totalSlides }) : null
  );

  const [override] = getSlotEntries("participantBody", slotProps);
  if (override) return <override.Component {...slotProps} />;

  // Audience pace (W2-F): the participant moves through every slide on their own, from the lobby to the end.
  if (audiencePaced && (status === "lobby" || status === "active" || status === "ended")) return <AudienceRun />;

  if (status === "lobby") {
    return (
      <div className="text-center space-y-4">
        <Hourglass className="mx-auto size-10 text-deck-primary-ink motion-safe:animate-pulse" aria-hidden="true" />
        <h2 className="text-2xl font-semibold tracking-[-0.03em]">{t("lobbyTitle")}</h2>
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
        <Loader2 className="size-6 animate-spin mx-auto" aria-hidden="true" />
        <p className="text-sm" role="status">{t("waitingForSlide")}</p>
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
