"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveStore, LiveStoreApi } from "@/features/presentations/live/store";
import type { LiveState } from "@/features/presentations/live/reducer";

/**
 * The presenter view and the audience window (`/presentation/<id>/present`,
 * opened with `window.open`) talk over a `BroadcastChannel` named after the
 * deck. The presenter view owns the session (REST, socket, commands); the
 * audience window has no socket of its own and renders the presenter's live
 * state, so both always show the same slide, phase, timer and results.
 *
 * Messages:
 * - audience → presenter `hello`: "send me the state" (on load, then every 2 s
 *   until one arrives);
 * - presenter → audience `state`: the live state's data (no functions), sent on
 *   every change (at most every 50 ms) and every 2 s as a heartbeat;
 * - presenter → audience `ui`: presenter-side display choices (sound cues,
 *   the start countdown);
 * - presenter → audience `bye`: the presenter view is closing.
 *
 * BroadcastChannel only reaches windows of the same browser profile on the same
 * origin, which is what a presenter's own second screen is. Snapshots carry the
 * host's deck (speaker notes included) between two of the host's own windows;
 * the audience window never renders notes.
 */

export const audienceChannelName = (presentationId: string) => `openpoll-presenter-${presentationId}`;

/** What the presenter view shares besides the live state. */
export interface AudienceUi {
  /** Play sound cues in the audience window (muted by default). */
  sound: boolean;
  /** Seconds left of the start countdown, or null. */
  countdown: number | null;
}

export type LiveStateData = LiveState;

export type AudienceMessage =
  | { type: "hello" }
  | { type: "state"; state: LiveStateData; ui: AudienceUi; sentAt: number }
  | { type: "bye" };

const THROTTLE_MS = 50;
const HEARTBEAT_MS = 2_000;
const HELLO_RETRY_MS = 2_000;

/** The live store's data fields: functions cannot cross a BroadcastChannel (structured clone). */
export function liveStateData(store: LiveStore): LiveStateData {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(store)) {
    if (typeof value !== "function") data[key] = value;
  }
  return data as unknown as LiveStateData;
}

const openChannel = (presentationId: string): BroadcastChannel | null =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(audienceChannelName(presentationId));

const post = (channel: BroadcastChannel, message: AudienceMessage) => {
  try {
    channel.postMessage(message);
  } catch {
    // A module slice that cannot be cloned: send it as JSON instead.
    channel.postMessage(JSON.parse(JSON.stringify(message)) as AudienceMessage);
  }
};

/**
 * Presenter side: mirrors the live store (and `ui`) to every audience window
 * of this deck. Returns whether an audience window answered recently (it says
 * hello when it opens), so the presenter view can show it.
 */
export function useAudienceBroadcast(presentationId: string, store: LiveStoreApi, ui: AudienceUi): { audienceSeen: boolean } {
  const uiRef = useRef(ui);
  const sendRef = useRef<(() => void) | null>(null);
  const [audienceSeen, setAudienceSeen] = useState(false);

  useEffect(() => {
    uiRef.current = ui;
    sendRef.current?.();
  }, [ui]);

  useEffect(() => {
    const channel = openChannel(presentationId);
    if (!channel) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSent = 0;

    const send = () => {
      lastSent = Date.now();
      post(channel, { type: "state", state: liveStateData(store.getState()), ui: uiRef.current, sentAt: lastSent });
    };
    const schedule = () => {
      if (timer) return;
      const wait = Math.max(0, lastSent + THROTTLE_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        send();
      }, wait);
    };
    sendRef.current = schedule;

    channel.onmessage = (event: MessageEvent<AudienceMessage>) => {
      if (event.data?.type !== "hello") return;
      setAudienceSeen(true);
      send();
    };
    const unsubscribe = store.subscribe(schedule);
    const heartbeat = setInterval(send, HEARTBEAT_MS);
    const onLeave = () => post(channel, { type: "bye" });
    window.addEventListener("pagehide", onLeave);
    send();

    return () => {
      window.removeEventListener("pagehide", onLeave);
      onLeave();
      unsubscribe();
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      sendRef.current = null;
      channel.close();
    };
  }, [presentationId, store]);

  return { audienceSeen };
}

export type AudienceLink = "waiting" | "live" | "closed";

/**
 * Audience side: asks the presenter view for the state and applies every
 * snapshot to this window's store. `link` is `waiting` until the first
 * snapshot, `live` while snapshots arrive, `closed` after the presenter view
 * said goodbye (the last state stays on screen).
 */
export function useAudienceMirror(presentationId: string, store: LiveStoreApi): { link: AudienceLink; ui: AudienceUi } {
  const [link, setLink] = useState<AudienceLink>("waiting");
  const [ui, setUi] = useState<AudienceUi>({ sound: false, countdown: null });

  useEffect(() => {
    const channel = openChannel(presentationId);
    if (!channel) return;
    let received = false;
    const hello = () => post(channel, { type: "hello" });
    const retry = setInterval(() => {
      if (!received) hello();
    }, HELLO_RETRY_MS);

    channel.onmessage = (event: MessageEvent<AudienceMessage>) => {
      const message = event.data;
      if (message?.type === "state") {
        received = true;
        // Merges the data fields; the store's own functions stay.
        store.setState(message.state as Partial<LiveStore>);
        setUi((prev) =>
          prev.sound === message.ui.sound && prev.countdown === message.ui.countdown ? prev : message.ui
        );
        setLink("live");
      } else if (message?.type === "bye") {
        received = false;
        setLink("closed");
      }
    };
    hello();

    return () => {
      clearInterval(retry);
      channel.close();
    };
  }, [presentationId, store]);

  return { link, ui };
}
