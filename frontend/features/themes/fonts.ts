import type { ThemeFont } from "./types";

const SYSTEM_STACK = "ui-sans-serif, system-ui, sans-serif";
const SERIF = new Set(["Merriweather", "Lora", "Playfair Display"]);

/** Mirror of the backend's `themeFont` (modules/themes/fonts.ts), for previews of unsaved kits. */
export function themeFont(choice: string): ThemeFont {
  if (choice === "System") return { family: SYSTEM_STACK, source: "system", url: null };
  const fallback = SERIF.has(choice) ? "ui-serif, Georgia, serif" : SYSTEM_STACK;
  const family = encodeURIComponent(choice).replace(/%20/g, "+");
  return {
    family: `"${choice}", ${fallback}`,
    source: "google",
    url: `https://fonts.googleapis.com/css2?family=${family}:wght@400;600;700&display=swap`,
  };
}
