"use client";

import type { ReactNode } from "react";
import { useLive } from "@/features/presentations/live/store";
import { DeckThemeProvider } from "@/features/presentations/theme/DeckThemeProvider";
import { deckThemeFrom } from "./deckTheme";

/** The live store's session theme as a DeckThemeProvider (host console and participant shell). */
export function LiveDeckTheme({ children }: { children: ReactNode }) {
  const tokens = useLive((s) => s.theme);
  return <DeckThemeProvider theme={deckThemeFrom(tokens)}>{children}</DeckThemeProvider>;
}
