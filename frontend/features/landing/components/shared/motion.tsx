"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { useMounted } from "@/hooks/use-mounted";

/** The brand curve, `--ease-brand` in globals.css. */
export const ease = [0.32, 0.72, 0, 1] as const;

/**
 * Walks 0 → `steps - 1`, one step every `ms` while `play` is true, then holds.
 * Scenes use it as a tiny timeline. Reduced motion jumps straight to the end.
 */
export function useStepper(steps: number, ms: number, play = true) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!play || reduce) return;
    const id = window.setInterval(() => {
      setStep((s) => {
        if (s >= steps - 1) {
          window.clearInterval(id);
          return s;
        }
        return s + 1;
      });
    }, ms);
    return () => window.clearInterval(id);
  }, [play, reduce, steps, ms]);

  return reduce ? steps - 1 : step;
}

/** True once the element has been half on screen; illustrations start playing from there. */
export function useSeen<T extends Element>(amount = 0.5) {
  const ref = useRef<T>(null);
  const seen = useInView(ref, { once: true, amount });
  return [ref, seen] as const;
}

/**
 * Reduced motion as a value that is safe to render with: false on the server
 * and during hydration (the server cannot know the setting), the real
 * preference once mounted. Use it wherever it changes the first frame.
 */
export function useInstant() {
  const reduce = useReducedMotion();
  return useMounted() && Boolean(reduce);
}

/**
 * A number that counts from `from` to `value` (on mount, and again whenever
 * `value` changes). Mono, tabular. Reduced motion shows the value at once.
 */
export function CountUp({
  value,
  from = 0,
  duration = 900,
  decimals = 0,
  suffix = "",
  className,
}: {
  value: number;
  from?: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const reduce = useInstant();
  const [shown, setShown] = useState(from);
  const start = useRef(from);

  useEffect(() => {
    if (reduce) return;
    const begin = start.current;
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      // Ease out cubic: fast at first, settling at the value.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(begin + (value - begin) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else start.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduce]);

  return (
    <span className={className}>
      {(reduce ? value : shown).toFixed(decimals)}
      {suffix}
    </span>
  );
}
