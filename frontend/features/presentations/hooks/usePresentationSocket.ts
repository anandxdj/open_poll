"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { acquireSocket, releaseSocket } from "@/lib/socket";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import type { PresentationRealtimeEvent } from "../types";

export type PresentationSocketAuth =
  | { role: "host" }
  | { role: "participant"; participantId: string; participantToken: string };

export function usePresentationSocket(
  presentationId: string | undefined,
  onEvent: (event: PresentationRealtimeEvent) => void,
  auth: PresentationSocketAuth | undefined
): { connected: boolean } {
  // Always calls the latest `onEvent` without resubscribing the socket.
  const handleRealtimeEvent = useEffectEvent((event: PresentationRealtimeEvent) => {
    onEvent(event);
  });
  const [connected, setConnected] = useState(false);

  const role = auth?.role;
  const participantId = auth?.role === "participant" ? auth.participantId : undefined;
  const participantToken = auth?.role === "participant" ? auth.participantToken : undefined;

  useEffect(() => {
    if (!presentationId || !role) return;
    if (role === "participant" && (!participantId || !participantToken)) return;

    const socket = acquireSocket();
    // The shared socket may already be connected (or not) — mirror its current
    // status; later changes arrive through the listeners below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnected(socket.connected);

    const join = () => {
      if (role === "host") {
        const accessToken = useAuthStore.getState().accessToken;
        if (!accessToken) return;
        socket.emit("quiz:join", { quizId: presentationId, role: "host", accessToken });
      } else {
        socket.emit("quiz:join", {
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
    const handleConnect = () => { setConnected(true); join(); };
    const handleDisconnect = () => setConnected(false);
    const handleConnectError = () => setConnected(false);

    join();
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("quiz:event", handleEvent);

    return () => {
      socket.emit("quiz:leave", presentationId);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("quiz:event", handleEvent);
      releaseSocket();
    };
  }, [presentationId, role, participantId, participantToken]);

  return { connected };
}

export const useQuizSocket = usePresentationSocket;
