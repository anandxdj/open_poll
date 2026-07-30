"use client";

import { useEffect, useRef, useState } from "react";
import { acquireSocket, releaseSocket } from "@/lib/socket";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import type { QuizRealtimeEvent } from "../types";

export type QuizSocketAuth =
  | { role: "host" }
  | { role: "participant"; participantId: string; participantToken: string };

export function useQuizSocket(
  quizId: string | undefined,
  onEvent: (event: QuizRealtimeEvent) => void,
  auth: QuizSocketAuth | undefined
): { connected: boolean } {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  const participantId = auth?.role === "participant" ? auth.participantId : undefined;
  const participantToken = auth?.role === "participant" ? auth.participantToken : undefined;

  useEffect(() => {
    if (!quizId || !auth) return;
    if (auth.role === "participant" && (!participantId || !participantToken)) return;

    const socket = acquireSocket();
    setConnected(socket.connected);

    const join = () => {
      if (auth.role === "host") {
        const accessToken = useAuthStore.getState().accessToken;
        if (!accessToken) return;
        socket.emit("quiz:join", { quizId, role: "host", accessToken });
      } else {
        socket.emit("quiz:join", { quizId, role: "participant", participantId, participantToken });
      }
    };
    const handleEvent = (event: QuizRealtimeEvent) => {
      if (event?.quizId === quizId) onEventRef.current(event);
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
      socket.emit("quiz:leave", quizId);
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("quiz:event", handleEvent);
      releaseSocket();
    };
  }, [quizId, auth?.role, participantId, participantToken]);

  return { connected };
}
