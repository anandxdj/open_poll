"use client";

import { useSyncExternalStore } from "react";
import { countdownAt, type CountdownInput, type CountdownValue } from "./clock";

// One 100 ms ticker shared by every mounted countdown. The snapshot is the
// client time of the last tick, so a countdown that mounts late (a tab switch,
// a remount) reads the current time on its first render instead of a value
// from when its deadline arrived.
const TICK_MS = 100;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  // Not ticking yet (first render of the first countdown): read the clock once.
  if (!timer) now = Date.now();
  return now;
}

// Server render: no clock; `countdownAt` shows the full budget.
const getServerSnapshot = () => Number.NaN;

/**
 * Server-synced countdown for an answer window. `timing.clockOffsetMs` was
 * measured when `endsAt` arrived (see `clock.ts`), so neither client clock
 * skew nor the moment the component mounted can shift the deadline. Untimed
 * windows (`endsAt: null`) report `timed: false` and never expire.
 */
export function useCountdown(timing: CountdownInput | null | undefined, totalSeconds: number = 30): CountdownValue {
  const clientNow = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return countdownAt(timing, clientNow, totalSeconds);
}
