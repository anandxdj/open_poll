"use client";

import { useEffect, useState } from "react";

import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { acquireSocket, releaseSocket } from "@/lib/socket";

// Builder presence (W3-B2): who else has this deck open in the builder.
// Backend: `presentations/editor.socket.ts` (`deck:join` with an ack, resent as
// a heartbeat; `presence:update` when someone opens or leaves the deck).

export interface DeckEditor {
  userId: string;
  name: string;
  since: string;
  /** Open builders of this user on the deck. */
  tabs: number;
}

export interface DeckPresence {
  /** Other people with the deck open, earliest first. */
  others: DeckEditor[];
  /** The signed-in user also has the deck open elsewhere (another tab or device). */
  selfElsewhere: boolean;
}

type JoinAck = { ok: true; editors: DeckEditor[] } | { ok: false; error: string };

/** The server drops an editor after 75 s without a heartbeat. */
const HEARTBEAT_MS = 30_000;

const NOBODY: DeckPresence = { others: [], selfElsewhere: false };

export function splitPresence(editors: DeckEditor[], selfId: string | null | undefined): DeckPresence {
  const self = editors.find((editor) => editor.userId === selfId);
  return { others: editors.filter((editor) => editor.userId !== selfId), selfElsewhere: (self?.tabs ?? 0) > 1 };
}

/** Joins the deck's editor presence while the builder shows a saved deck. */
export function useDeckPresence(deckId: string | null): DeckPresence {
  const accessToken = useAuthStore((state) => state.accessToken);
  const selfId = useAuthStore((state) => state.user?._id ?? null);
  const [state, setState] = useState<{ deckId: string; editors: DeckEditor[] } | null>(null);

  useEffect(() => {
    if (!deckId || !accessToken) return;
    const socket = acquireSocket();
    let active = true;
    const apply = (editors: DeckEditor[]) => {
      if (active) setState({ deckId, editors });
    };
    const join = () => {
      socket.timeout(5_000).emit("deck:join", { presentationId: deckId, accessToken }, (err: Error | null, ack?: JoinAck) => {
        if (!err && ack?.ok) apply(ack.editors);
      });
    };
    const onUpdate = (event: { presentationId?: string; editors?: DeckEditor[] }) => {
      if (event?.presentationId === deckId && Array.isArray(event.editors)) apply(event.editors);
    };
    socket.on("presence:update", onUpdate);
    socket.on("connect", join);
    if (socket.connected) join();
    const heartbeat = window.setInterval(join, HEARTBEAT_MS);
    return () => {
      active = false;
      window.clearInterval(heartbeat);
      socket.off("presence:update", onUpdate);
      socket.off("connect", join);
      if (socket.connected) socket.emit("deck:leave", { presentationId: deckId });
      releaseSocket();
    };
  }, [deckId, accessToken]);

  if (!deckId || state?.deckId !== deckId) return NOBODY;
  return splitPresence(state.editors, selfId);
}
