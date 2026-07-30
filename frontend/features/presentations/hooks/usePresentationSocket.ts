"use client";

import { useEffect, useRef, useState } from "react";
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
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  const participantId = auth?.role === "participant" ? auth.participantId : undefined;
  const participantToken = auth?.role === "participant" ? auth.participantToken : undefined;

  useEffect(() => {
    if (!presentationId || !auth) return;
    if (auth.role === "participant" && (!participantId || !participantToken)) return;

    const socket = acquireSocket();
    setConnected(socket.connected);

    const join = () => {
      if (auth.role === "host") {
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
        onEventRef.current(event);
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
  }, [presentationId, auth?.role, participantId, participantToken]);

  return { connected };
}

export const useQuizSocket = usePresentationSocket;
