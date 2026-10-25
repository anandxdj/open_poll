"use client";

import { useEffect, useEffectEvent } from "react";
import { acquireSocket, releaseSocket } from "@/lib/socket";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import {
  LIVE_SOCKET_EVENTS,
  type LiveJoinAck,
  type LiveSocketAuth,
  type PresentationRealtimeEvent,
} from "../types/realtime";
import { planEnvelope } from "./reducer";
import { useLive, useLiveStore } from "./store";

/** Why a surface should re-read its state from REST instead of trusting the event stream. */
export type ResyncReason =
  /** The socket (re)joined the deck's rooms: events between the last read and now may be missing. */
  | "joined"
  /** The host's `seq` skipped a number (it receives every `all` + `host` event, so one was lost). */
  | "gap"
  /** `seq` went backwards: the counter restarted, or events arrived out of order. */
  | "reset"
  /** The tab came back to the foreground (phones suspend sockets silently). */
  | "visible";

export interface LiveSocketHandlers {
  /** Side effects of every event of the followed session, after it reached the store. */
  onEvent?: (event: PresentationRealtimeEvent) => void;
  /** Re-read the surface's state (host: `host/state`; participant: `live-state`). */
  onResync?: (reason: ResyncReason) => void;
  /**
   * An envelope of another session of this deck arrived (the store only
   * recorded its `seq`). The followed session is probably over, or a second
   * host window started one: re-check which session is live.
   */
  onForeignSession?: (event: PresentationRealtimeEvent) => void;
  /** The room join was refused (`UNAUTHENTICATED`, `FORBIDDEN`, …). */
  onJoinError?: (error: string) => void;
}

/** Retry delay after the join budget (30/min per connection) was exceeded. */
const RATE_LIMIT_RETRY_MS = 5_000;

/**
 * Joins a deck's live rooms on the shared socket (`live:join`, with an ack)
 * and feeds every `live:event` envelope of that deck into the surrounding
 * live store, then calls the handlers for side effects. Only the versioned
 * protocol is used: the legacy `quiz:*` events are not listened to.
 *
 * Per envelope: events of another session only record their `seq`
 * (`onForeignSession`); a repeated `seq` is dropped; the host resyncs on a
 * `seq` gap and everybody on a `seq` reset — before the event is applied, so
 * the store replays it on top of the snapshot. Participants do not treat a
 * gap as loss: `seq` counts host-only and other participants' events too.
 * Every (re)join, and every return to a visible tab, asks for a resync.
 * Connection status lands in the store as `connected` (socket connected *and*
 * joined).
 *
 * Pass `auth = undefined` to stay out of the room — the server rejects a
 * participant join without credentials, so wait until the nickname gate
 * resolved. `handlers` may also be a bare `onEvent` function.
 */
export function useLiveSocket(
  presentationId: string | null | undefined,
  auth: LiveSocketAuth | undefined,
  handlers?: LiveSocketHandlers | ((event: PresentationRealtimeEvent) => void)
): { connected: boolean } {
  const store = useLiveStore();
  const connected = useLive((s) => s.connected);
  const resolved: LiveSocketHandlers = typeof handlers === "function" ? { onEvent: handlers } : (handlers ?? {});

  // Always call the latest handlers without resubscribing the socket.
  const handleRealtimeEvent = useEffectEvent((event: PresentationRealtimeEvent) => {
    const state = store.getState();
    const plan = planEnvelope(state, event);
    if (plan.kind === "duplicate") return;
    if (plan.kind === "foreign") {
      state.dispatch({ type: "live/event", event, receivedAt: Date.now() });
      resolved.onForeignSession?.(event);
      return;
    }
    // Resync first: the store replays the events that arrive while it loads.
    if (plan.resync) resolved.onResync?.(plan.resync);
    state.dispatch({ type: "live/event", event, receivedAt: Date.now() });
    resolved.onEvent?.(event);
  });
  const handleJoined = useEffectEvent(() => resolved.onResync?.("joined"));
  const handleVisible = useEffectEvent(() => resolved.onResync?.("visible"));
  const handleJoinError = useEffectEvent((error: string) => resolved.onJoinError?.(error));

  const role = auth?.role;
  const participantId = auth?.role === "participant" ? auth.participantId : undefined;
  const participantToken = auth?.role === "participant" ? auth.participantToken : undefined;

  useEffect(() => {
    if (!presentationId || !role) return;
    if (role === "participant" && (!participantId || !participantToken)) return;

    const socket = acquireSocket();
    let joined = false;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const setConnected = (value: boolean) =>
      store.getState().dispatch({ type: "live/connection", connected: value });

    const join = () => {
      if (disposed || !socket.connected) return;
      const payload =
        role === "host"
          ? { presentationId, role: "host" as const, accessToken: useAuthStore.getState().accessToken ?? undefined }
          : { presentationId, role: "participant" as const, participantId, participantToken };
      socket.emit(LIVE_SOCKET_EVENTS.join, payload, (ack: LiveJoinAck | undefined) => {
        if (disposed) return;
        if (ack?.ok) {
          joined = true;
          setConnected(true);
          handleJoined();
          return;
        }
        joined = false;
        setConnected(false);
        const error = ack && !ack.ok ? ack.error : "NO_ACK";
        handleJoinError(error);
        if (error === "RATE_LIMITED") retryTimer = setTimeout(join, RATE_LIMIT_RETRY_MS);
      });
    };

    const handleEvent = (event: PresentationRealtimeEvent) => {
      if (event?.presentationId === presentationId || event?.quizId === presentationId) handleRealtimeEvent(event);
    };
    const handleConnect = () => join();
    const handleDisconnect = () => {
      joined = false;
      setConnected(false);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && joined) handleVisible();
    };

    // The shared socket may already be connected — join now; later (re)connects
    // arrive through the listener below.
    setConnected(false);
    join();
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleDisconnect);
    socket.on(LIVE_SOCKET_EVENTS.event, handleEvent);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      socket.emit(LIVE_SOCKET_EVENTS.leave, { presentationId });
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleDisconnect);
      socket.off(LIVE_SOCKET_EVENTS.event, handleEvent);
      releaseSocket();
    };
  }, [store, presentationId, role, participantId, participantToken]);

  return { connected };
}
