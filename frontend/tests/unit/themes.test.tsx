import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DeckThemeProvider, deckThemeStyle } from "@/features/presentations/theme/DeckThemeProvider";
import { contrastFailures, contrastRatio, describeFailure } from "@/features/themes/contrast";
import { deckThemeFrom } from "@/features/themes/deckTheme";
import { themeFont } from "@/features/themes/fonts";
import type { ThemeTokens } from "@/features/themes/types";

const tokens = (over: Partial<ThemeTokens> = {}): ThemeTokens => ({
  presetId: "ocean",
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
  test("the built-in look changes nothing", () => {
    expect(deckThemeFrom(null)).toBeNull();
    expect(deckThemeFrom(tokens({ custom: false }))).toBeNull();
  });

  test("the stage takes the palette; phones only the accent", () => {
    const theme = deckThemeFrom(tokens())!;
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
    });
    expect(theme.tokens).not.toHaveProperty("bg");
    expect(theme.tokens).not.toHaveProperty("fg");
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
    expect(deckThemeStyle(null)).toBeUndefined();
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
