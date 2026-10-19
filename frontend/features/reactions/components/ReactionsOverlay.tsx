"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { useLive } from "@/features/presentations/live/store";
import { floatersFor, initialReactionState, REACTION_PREFIX, type ReactionState } from "../state";

interface Floater {
  id: number;
  emoji: string;
  /** Horizontal start, % of the stage width. */
  left: number;
  drift: number;
  duration: number;
  delay: number;
}

const MAX_ACTIVE = 60;

/** Pure: the floaters for one burst. `random` is injectable for tests. */
export function makeFloaters(counts: Record<string, number>, firstId: number, random: () => number = Math.random): Floater[] {
  return floatersFor(counts).map((emoji, index) => ({
    id: firstId + index,
    emoji,
    left: 6 + random() * 88,
    drift: (random() - 0.5) * 80,
    duration: 2.6 + random() * 1.4,
    delay: random() * 0.35,
  }));
}

const selectReaction = (state: { modules: Record<string, unknown> }) =>
  (state.modules[REACTION_PREFIX] as ReactionState | undefined) ?? initialReactionState;

/**
 * Emoji floating up the stage, one batch per `reaction:burst` (at most every
 * 500 ms per session, so a loud room cannot flood the DOM: a batch is capped
 * and so is the number alive at once).
 */
export function ReactionsOverlay() {
  const burst = useLive(selectReaction);
  const reduceMotion = useReducedMotion();
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const nextId = useRef(1);
  const seen = useRef(0);

  useEffect(() => {
    if (burst.burstId === 0 || burst.burstId === seen.current) return;
    seen.current = burst.burstId;
    const batch = makeFloaters(burst.counts, nextId.current);
    nextId.current += batch.length;
    setFloaters((prev) => [...prev, ...batch].slice(-MAX_ACTIVE));
    const ids = new Set(batch.map((f) => f.id));
    const timer = window.setTimeout(
      () => setFloaters((prev) => prev.filter((f) => !ids.has(f.id))),
      (reduceMotion ? 1.6 : 4.4) * 1000
    );
    return () => window.clearTimeout(timer);
  }, [burst, reduceMotion]);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      {floaters.map((f) => (
        <motion.span
          key={f.id}
          data-reaction-floater={f.emoji}
          className="absolute bottom-2 text-4xl select-none"
          style={{ left: `${f.left}%` }}
          initial={{ opacity: 0, y: 0, x: 0, scale: 0.6 }}
          animate={
            reduceMotion
              ? { opacity: [0, 1, 1, 0], scale: 1 }
              : { opacity: [0, 1, 1, 0], y: -340, x: f.drift, scale: [0.6, 1.15, 1] }
          }
          transition={{ duration: reduceMotion ? 1.4 : f.duration, delay: f.delay, ease: "easeOut" }}
        >
          {f.emoji}
        </motion.span>
      ))}
    </div>
  );
}
