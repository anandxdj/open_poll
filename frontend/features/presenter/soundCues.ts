"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LiveStoreApi } from "@/features/presentations/live/store";
import { countdownAt } from "@/features/presentations/live/clock";

/**
 * Optional sound cues (W2-A), muted by default: a rising chirp when a question
 * opens, a chime on the reveal, short ticks in the last three seconds of a
 * timer. Synthesized with the Web Audio API (no audio files). They play in the
 * audience window when one is open (the projector usually has the speakers),
 * else in the presenter view.
 */

export type CueKind = "start" | "reveal" | "tick" | "end";

const NOTES: Record<CueKind, { freqs: number[]; step: number; length: number; gain: number }> = {
  start: { freqs: [523.25, 659.25, 783.99], step: 0.09, length: 0.18, gain: 0.18 },
  reveal: { freqs: [783.99, 1046.5], step: 0.12, length: 0.35, gain: 0.2 },
  tick: { freqs: [880], step: 0, length: 0.06, gain: 0.12 },
  end: { freqs: [392, 329.63], step: 0.15, length: 0.3, gain: 0.18 },
};

let context: AudioContext | null = null;

const audio = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
};

/** Plays one cue now. Silent where audio is unavailable or not yet allowed by the browser. */
export function playCue(kind: CueKind) {
  const ctx = audio();
  if (!ctx) return;
  const { freqs, step, length, gain } = NOTES[kind];
  freqs.forEach((freq, i) => {
    const start = ctx.currentTime + i * step;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(env).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + length + 0.02);
  });
}

const SOUND_KEY = "openpoll_presenter_sound";
const soundListeners = new Set<() => void>();
/** This page's choice when storage is blocked. */
let soundFallback = false;

function readSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return soundFallback;
  }
}

function writeSoundPreference(on: boolean) {
  soundFallback = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Not remembered in blocked storage; muted next time.
  }
  soundListeners.forEach((notify) => notify());
}

const subscribeSound = (onChange: () => void) => {
  soundListeners.add(onChange);
  return () => soundListeners.delete(onChange);
};

/** The presenter's sound-cue choice, remembered per browser; muted by default (and during the server render). */
export function useSoundPreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeSound, readSoundPreference, () => false);
  return [on, writeSoundPreference];
}

/** Plays cues from the live store's transitions while `enabled`. */
export function useSoundCues(store: LiveStoreApi, enabled: boolean) {
  const last = useRef<{ window: string | null; phase: string | null; second: number | null }>({
    window: null,
    phase: null,
    second: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const snapshot = () => {
      const s = store.getState();
      return { window: s.timing?.startedAt ? `${s.slideId}:${s.timing.startedAt}` : null, phase: s.phase };
    };
    // Start from what is on screen now: no cue for a state that was already there.
    last.current = { ...snapshot(), second: null };

    const unsubscribe = store.subscribe(() => {
      const now = snapshot();
      if (now.window && now.window !== last.current.window && now.phase === "open") playCue("start");
      if (now.phase === "revealed" && last.current.phase !== "revealed") playCue("reveal");
      last.current = { ...last.current, ...now };
    });

    const ticker = setInterval(() => {
      const s = store.getState();
      if (s.phase !== "open" || !s.timing) {
        last.current.second = null;
        return;
      }
      const slide = s.deck?.slides[s.currentSlideIndex];
      const value = countdownAt(s.timing, Date.now(), slide?.timeLimit ?? 30);
      if (!value.timed || value.paused) return;
      const second = value.secondsLeft;
      if (second === last.current.second) return;
      if (second > 0 && second <= 3) playCue("tick");
      if (second === 0 && last.current.second !== null && last.current.second > 0) playCue("end");
      last.current.second = second;
    }, 200);

    return () => {
      unsubscribe();
      clearInterval(ticker);
    };
  }, [store, enabled]);
}
