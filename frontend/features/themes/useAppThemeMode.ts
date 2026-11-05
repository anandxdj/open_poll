"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { DEFAULT_THEME_MODE, type ThemeMode } from "./types";

const noSubscription = () => () => {};

/**
 * The app's light or dark theme as the user sees it now (`next-themes`
 * resolved theme: "system" becomes the device's). Light until it is known:
 * on the server and during hydration (the server cannot know it, and an
 * attribute that differs from the server HTML is not patched by React), then
 * the real one right after. A new deck takes it as its mode.
 */
export function useAppThemeMode(): ThemeMode {
  const { resolvedTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );
  if (!hydrated) return DEFAULT_THEME_MODE;
  return resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : DEFAULT_THEME_MODE;
}
