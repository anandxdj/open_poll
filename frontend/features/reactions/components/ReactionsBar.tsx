"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";

import { useLive } from "@/features/presentations/live/store";
import { selectQna, useQnaSync } from "@/features/qna/useQnaSync";
import { acquireSocket, getSocket, releaseSocket } from "@/lib/socket";
import type { ReactionAck } from "@/features/qna/types";

export const REACTION_SEND_EVENT = "reaction:send";
/** The server allows 5 per second per socket; stay a little under it. */
export const MIN_GAP_MS = 220;

/** Returns a function that says whether an action may run now: at most one per `gapMs`. */
export function createGate(gapMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < gapMs) return false;
    last = t;
    return true;
  };
}

/**
 * Participant footer: one button per emoji the deck allows. A tap emits
 * `reaction:send` on the shared socket (the server validates the token, the
 * emoji and the rate limits) and pops the emoji locally right away, so the
 * phone never waits for the stage.
 */
export function ReactionsBar() {
  const t = useTranslations("qna.reactions");
  useQnaSync();
  const reactions = useLive((s) => selectQna(s).reactions);
  const status = useLive((s) => s.status);
  const presentationId = useLive((s) => s.presentationId);
  const self = useLive((s) => s.self);
  const reduceMotion = useReducedMotion();

  const [pops, setPops] = useState<{ id: number; emoji: string }[]>([]);
  const gate = useRef(createGate(MIN_GAP_MS));
  const nextPop = useRef(1);
  const [unavailable, setUnavailable] = useState(false);

  const active = Boolean(reactions?.enabled && reactions.emojis.length > 0 && status !== "ended" && self && presentationId);

  // Hold a socket reference while the bar is on screen (shared, refcounted).
  useEffect(() => {
    if (!active) return;
    acquireSocket();
    return () => releaseSocket();
  }, [active]);

  if (!active || !reactions || !self || !presentationId || unavailable) return null;

  const send = (emoji: string) => {
    if (!gate.current()) return;

    const id = nextPop.current++;
    setPops((prev) => [...prev.slice(-5), { id, emoji }]);
    window.setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 900);

    const socket = getSocket();
    if (!socket.connected) return;
    socket.emit(
      REACTION_SEND_EVENT,
      { presentationId, participantId: self.participantId, participantToken: self.token, emoji },
      (ack: ReactionAck | undefined) => {
        if (ack && !ack.ok && (ack.error === "DISABLED" || ack.error === "SESSION_ENDED")) setUnavailable(true);
      }
    );
  };

  return (
    <div className="relative border-t border-deck-border/40 bg-deck-surface/60 px-4 py-2.5 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-x-0 bottom-full flex h-16 justify-center gap-2" aria-hidden>
        {pops.map((pop) => (
          <motion.span
            key={pop.id}
            initial={{ opacity: 0, y: 12, scale: 0.7 }}
            animate={reduceMotion ? { opacity: [0, 1, 0] } : { opacity: [0, 1, 0], y: -44, scale: [0.7, 1.3, 1] }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            className="text-3xl"
          >
            {pop.emoji}
          </motion.span>
        ))}
      </div>
      <div role="group" aria-label={t("label")} className="mx-auto flex max-w-md items-center justify-center gap-2">
        {reactions.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => send(emoji)}
            aria-label={t("send", { emoji })}
            className="flex size-11 items-center justify-center rounded-full border border-deck-border/50 bg-deck-bg/60 text-2xl transition-transform hover:scale-110 active:scale-90"
          >
            <span aria-hidden>{emoji}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
