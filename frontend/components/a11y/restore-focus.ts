"use client";

import { useRef } from "react";

interface AutoFocusHandlers {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Gives focus back to whatever had it when a Radix dialog opened (W4-A). Radix
 * returns focus to its `Trigger`, and to nothing when the dialog is opened
 * from state (`open` prop) without one — the End session, Remove participant
 * and leaderboard dialogs — which left keyboard users on the page body. Pass
 * the dialog content's own handlers through; one that calls
 * `preventDefault()` keeps full control.
 */
export function useRestoreFocus({ onOpenAutoFocus, onCloseAutoFocus }: AutoFocusHandlers = {}) {
  const returnTo = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (event: Event) => {
      // Called as the dialog mounts, before focus moves into it.
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      const target = returnTo.current;
      returnTo.current = null;
      if (event.defaultPrevented || !target?.isConnected) return;
      event.preventDefault();
      target.focus();
    },
  };
}
