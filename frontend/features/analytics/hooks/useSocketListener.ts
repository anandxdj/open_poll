"use client";

import { useEffect, useRef } from "react";

import { getSocket } from "@/lib/socket";
import type { PollAnalyticsPayload } from "@/features/analytics/types";

type Args = {
  pollId: string | undefined;
  onUpdate: (payload: PollAnalyticsPayload) => void;
  enabled?: boolean;
};

export function useSocketListener({ pollId, onUpdate, enabled = true }: Args) {
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled || !pollId) return;

    const socket = getSocket();
    socket.connect();
    socket.emit("poll:join", pollId);

    const handler = (payload: PollAnalyticsPayload) => {
      if (payload.pollId === pollId) onUpdateRef.current(payload);
    };

    socket.on("analytics:update", handler);

    return () => {
      socket.emit("poll:leave", pollId);
      socket.off("analytics:update", handler);
      socket.disconnect();
    };
  }, [pollId, enabled]);
}
