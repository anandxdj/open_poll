"use client";

import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";
import type { PresentationRealtimeEvent } from "../types";

/**
 * Joins the presentation socket room and forwards every realtime event to `onEvent`.
 * Reconnects re-join the room automatically.
 */
export function usePresentationSocket(
  presentationId: string | undefined,
  onEvent: (event: PresentationRealtimeEvent) => void
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!presentationId) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const join = () => {
      socket.emit("quiz:join", presentationId);
    };
    const handleEvent = (event: PresentationRealtimeEvent) => {
      if (event?.presentationId === presentationId || event?.quizId === presentationId) {
        onEventRef.current(event);
      }
    };

    join();
    socket.on("connect", join);
    socket.on("quiz:event", handleEvent);

    return () => {
      socket.emit("quiz:leave", presentationId);
      socket.off("connect", join);
      socket.off("quiz:event", handleEvent);
      socket.disconnect();
    };
  }, [presentationId]);
}

export const useQuizSocket = usePresentationSocket;
