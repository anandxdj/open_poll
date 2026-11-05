import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DeckThemeProvider, deckThemeStyle } from "@/features/presentations/theme/DeckThemeProvider";
import { contrastFailures, contrastRatio, describeFailure } from "@/features/themes/contrast";
import { deckThemeFrom, deckThemeFromCard } from "@/features/themes/deckTheme";
import { themeFont } from "@/features/themes/fonts";
import type { ThemeTokens } from "@/features/themes/types";

const tokens = (over: Partial<ThemeTokens> = {}): ThemeTokens => ({
  presetId: "ocean",
  mode: "dark",
  brandKitId: null,
  custom: true,
  name: "Ocean",
  colors: {
    background: "#0b1622",
    surface: "#132233",
    text: "#eef4fa",
    mutedText: "#9fb3c8",
    accent: "#38bdf8",
    accentText: "#04202f",
    correct: "#34d399",
    incorrect: "#fb7185",
    chart: ["#38bdf8", "#a78bfa", "#34d399"],
  },
  fonts: { heading: themeFont("DM Sans"), body: themeFont("System") },
  logo: { url: "https://cdn.example.com/logo.png", alt: "Acme" },
  background: null,
  ...over,
});

describe("deck theme from a session snapshot", () => {
  test("the built-in look is only its mode; snapshots from before modes stay dark", () => {
    expect(deckThemeFrom(null)).toBeNull();
    expect(deckThemeFrom(tokens({ custom: false, mode: "light" }))).toEqual({ mode: "light" });
    expect(deckThemeFrom(tokens({ custom: false, mode: "dark" }))).toEqual({ mode: "dark" });
    expect(deckThemeFrom(tokens({ custom: false, mode: undefined }))).toEqual({ mode: "dark" });
    expect(deckThemeFrom(tokens({ mode: undefined }))!.mode).toBe("dark");
  });

  test("the stage and the phones take the palette, in the theme's mode", () => {
    const theme = deckThemeFrom(tokens())!;
    expect(theme.mode).toBe("dark");
    expect(theme.tokens).toMatchObject({
      "stage-bg": "#0b1622",
      "stage-fg": "#eef4fa",
      "stage-ink": "#04202f",
      accent: "#38bdf8",
      primary: "#38bdf8",
      "primary-fg": "#04202f",
      wrong: "#fb7185",
      "cloud-1": "#38bdf8",
      "cloud-4": "#38bdf8", // the chart colours repeat in order
      // Phones look like the stage now: same paper, ink and muted ink.
      bg: "#0b1622",
      fg: "#eef4fa",
      surface: "#132233",
      "muted-fg": "#9fb3c8",
    });
    expect(theme.tokens!.border).toContain("color-mix");
    const light = deckThemeFrom(
      tokens({
        mode: "light",
        colors: { ...tokens().colors, background: "#f1f6fa", surface: "#ffffff", text: "#0b1a2a", accent: "#0369a1", accentText: "#ffffff" },
      })
    )!;
    expect(light.mode).toBe("light");
    expect(light.tokens).toMatchObject({ "stage-bg": "#f1f6fa", bg: "#f1f6fa", fg: "#0b1a2a", "stage-ink": "#ffffff" });
    expect(theme.fonts).toEqual({
      heading: '"DM Sans", ui-sans-serif, system-ui, sans-serif',
      body: "ui-sans-serif, system-ui, sans-serif",
      urls: ["https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap"],
    });
    expect(theme.logo).toEqual({ url: "https://cdn.example.com/logo.png", alt: "Acme" });
  });

  test("the provider sets fonts and loads the stylesheet", () => {
    const theme = deckThemeFrom(tokens())!;
    expect(deckThemeStyle(theme)).toMatchObject({
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      "--theme-font-heading": '"DM Sans", ui-sans-serif, system-ui, sans-serif',
      "--deck-accent": "#38bdf8",
    });
    const html = renderToStaticMarkup(
      <DeckThemeProvider theme={theme}>
        <p>Stage</p>
      </DeckThemeProvider>
    );
    expect(html).toContain("fonts.googleapis.com/css2?family=DM+Sans");
    expect(html).toContain('data-deck-mode="dark"');
    expect(deckThemeStyle(null)).toBeUndefined();
    // Without a theme the scope has no mode: the :root look (dark stage, phones follow the app).
    expect(renderToStaticMarkup(<DeckThemeProvider theme={null}>x</DeckThemeProvider>)).not.toContain("data-deck-mode");
  });

  test("a library card preview maps to the stage tokens of its mode", () => {
    const card = { mode: "light" as const, custom: false, background: "#f6f6f3", surface: "#ffffff", text: "#171717", mutedText: "#5c5a55", accent: "#cf460c", accentText: "#ffffff" };
    expect(deckThemeFromCard(card)).toEqual({ mode: "light" });
    expect(deckThemeFromCard(null)).toBeNull();
    expect(deckThemeFromCard({ ...card, mode: "dark", custom: true, background: "#111111", text: "#f5f5f5" })).toMatchObject({
      mode: "dark",
      tokens: { "stage-bg": "#111111", "stage-fg": "#f5f5f5", accent: "#cf460c" },
    });
  });
});

describe("contrast (mirror of the API's checks)", () => {
  test("ratios and failures", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("not-a-colour", "#ffffff")).toBe(1);
    expect(contrastFailures(tokens().colors)).toEqual([]);
    const failures = contrastFailures({ ...tokens().colors, accentText: "#38bdf8" });
    expect(failures).toHaveLength(1);
    expect(describeFailure(failures[0]!)).toBe("Text on accent on Accent: 1.0:1, needs 4.5:1");
  });
});
