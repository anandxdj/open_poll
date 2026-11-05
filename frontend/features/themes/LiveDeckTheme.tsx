"use client";

import type { ReactNode } from "react";
import { useLive } from "@/features/presentations/live/store";
import { DeckThemeProvider } from "@/features/presentations/theme/DeckThemeProvider";
import { deckThemeFrom } from "./deckTheme";
import { useAppThemeMode } from "./useAppThemeMode";

/**
 * The live store's theme as a DeckThemeProvider (host console, presenter
 * view, audience window, screen stage, participant shell). A live session
 * (lobby, active) draws the snapshot it opened with, so editing the deck never
 * restyles it; otherwise the deck's current theme (host state `deckTheme`),
 * else the last snapshot. Until either is known (first load, no session) the
 * surface takes the app's light or dark theme.
 */
export function LiveDeckTheme({ children }: { children: ReactNode }) {
  const snapshot = useLive((s) => s.theme);
  const deckTheme = useLive((s) => s.deckTheme);
  const live = useLive((s) => s.status === "lobby" || s.status === "active");
  const appMode = useAppThemeMode();
  const tokens = live ? (snapshot ?? deckTheme) : (deckTheme ?? snapshot);
  return <DeckThemeProvider theme={deckThemeFrom(tokens) ?? { mode: appMode }}>{children}</DeckThemeProvider>;
}
