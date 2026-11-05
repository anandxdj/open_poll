"use client";

import { useSyncExternalStore, type RefObject } from "react";

export interface FullscreenControls {
  isFullscreen: boolean;
  /** False during the server render, and in browsers without the Fullscreen API (older iOS Safari). */
  supported: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
}

const subscribe = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};
const noSubscription = () => () => {};
const serverFalse = () => false;

/**
 * Fullscreen for a live surface: the whole page by default, or `target`.
 * Entering needs a user gesture in this window (a click or a key press), so
 * callers wire it to a button and the F key. Failures (no gesture, denied by
 * the browser) are ignored: the page simply stays as it is.
 */
export function useFullscreen(target?: RefObject<HTMLElement | null>): FullscreenControls {
  const isFullscreen = useSyncExternalStore(subscribe, () => Boolean(document.fullscreenElement), serverFalse);
  const supported = useSyncExternalStore(noSubscription, () => Boolean(document.fullscreenEnabled), serverFalse);

  const enter = () => {
    const element = target?.current ?? document.documentElement;
    if (document.fullscreenElement || !element.requestFullscreen) return;
    element.requestFullscreen().catch(() => {});
  };

  const exit = () => {
    if (!document.fullscreenElement) return;
    document.exitFullscreen().catch(() => {});
  };

  const toggle = () => {
    if (document.fullscreenElement) exit();
    else enter();
  };

  return { isFullscreen, supported, enter, exit, toggle };
}
