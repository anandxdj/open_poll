"use client";

import { useEffect, useEffectEvent } from "react";
import { acquireSocket, releaseSocket } from "@/lib/socket";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { LIVE_SOCKET_EVENTS, type LiveSocketAuth, type PresentationRealtimeEvent } from "../types/realtime";
import { useLive, useLiveStore } from "./store";

/**
 * Joins a deck's live room on the shared socket and feeds every event for
 * that deck into the surrounding live store (`live/event`), then calls
 * `onEvent` for side effects (refetches, storage). Connection status lands in
 * the store as `connected`. Re-joins on reconnect.
 *
 * Pass `auth = undefined` to stay out of the room — the server rejects a
 * participant join without credentials, so wait until the nickname gate
 * resolved.
 */
export function useLiveSocket(
  presentationId: string | null | undefined,
  auth: LiveSocketAuth | undefined,
  onEvent?: (event: PresentationRealtimeEvent) => void
): { connected: boolean } {
  const store = useLiveStore();
  const connected = useLive((s) => s.connected);
  // Always calls the latest `onEvent` without resubscribing the socket.
  const handleRealtimeEvent = useEffectEvent((event: PresentationRealtimeEvent) => {
    store.getState().dispatch({ type: "live/event", event });
    onEvent?.(event);
  });

  const role = auth?.role;
  const participantId = auth?.role === "participant" ? auth.participantId : undefined;
  const participantToken = auth?.role === "participant" ? auth.participantToken : undefined;

  useEffect(() => {
    if (!presentationId || !role) return;
    if (role === "participant" && (!participantId || !participantToken)) return;

    const socket = acquireSocket();
    const setConnected = (value: boolean) =>
      store.getState().dispatch({ type: "live/connection", connected: value });
    // The shared socket may already be connected (or not) — mirror its
    // current status; later changes arrive through the listeners below.
    setConnected(socket.connected);

    const join = () => {
      if (role === "host") {
        const accessToken = useAuthStore.getState().accessToken;
        if (!accessToken) return;
        socket.emit(LIVE_SOCKET_EVENTS.join, { quizId: presentationId, role: "host", accessToken });
      } else {
        socket.emit(LIVE_SOCKET_EVENTS.join, {
          quizId: presentationId,
          role: "participant",
          participantId,
          participantToken,
        });
      }
    };
    const handleEvent = (event: PresentationRealtimeEvent) => {
      if (event?.presentationId === presentationId || event?.quizId === presentationId)
        handleRealtimeEvent(event);
    };
    const handleConnect = () => {
      setConnected(true);
      join();
    };
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = () => setConnected(false);

    join();
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on(LIVE_SOCKET_EVENTS.event, handleEvent);

    return () => {
      socket.emit(LIVE_SOCKET_EVENTS.leave, presentationId);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off(LIVE_SOCKET_EVENTS.event, handleEvent);
      releaseSocket();
    };
  }, [store, presentationId, role, participantId, participantToken]);

  return { connected };
}
