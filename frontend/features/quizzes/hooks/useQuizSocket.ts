"use client";

import { useEffect, useRef } from "react";
import { getSocket } from "@/lib/socket";
import type { QuizRealtimeEvent } from "../types";

/**
 * Joins the quiz socket room and forwards every realtime event to `onEvent`.
 * Reconnects re-join the room automatically.
 */
export function useQuizSocket(
  quizId: string | undefined,
  onEvent: (event: QuizRealtimeEvent) => void
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!quizId) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const join = () => socket.emit("quiz:join", quizId);
    const handleEvent = (event: QuizRealtimeEvent) => {
      if (event?.quizId === quizId) onEventRef.current(event);
    };

    join();
    socket.on("connect", join);
    socket.on("quiz:event", handleEvent);

    return () => {
      socket.emit("quiz:leave", quizId);
      socket.off("connect", join);
      socket.off("quiz:event", handleEvent);
      socket.disconnect();
    };
  }, [quizId]);
}
