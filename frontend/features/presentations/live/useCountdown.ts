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

function getSnapshot(): number | null {
  // Not ticking yet (first render of the first countdown): read the clock, but
  // keep the value for one tick length so repeated reads agree (React checks).
  if (!timer) {
    const read = Date.now();
    if (read - now > TICK_MS) now = read;
  }
  return now;
}

// Server render and hydration: no clock (`countdownAt` shows the full budget).
// `null`, not NaN: React compares server snapshots with `!==` and NaN never equals itself.
const getServerSnapshot = (): number | null => null;

/**
 * Server-synced countdown for an answer window. `timing.clockOffsetMs` was
 * measured when `endsAt` arrived (see `clock.ts`), so neither client clock
 * skew nor the moment the component mounted can shift the deadline. Untimed
 * windows (`endsAt: null`) report `timed: false` and never expire.
 */
export function useCountdown(timing: CountdownInput | null | undefined, totalSeconds: number = 30): CountdownValue {
  const clientNow = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return countdownAt(timing, clientNow ?? Number.NaN, totalSeconds);
}
