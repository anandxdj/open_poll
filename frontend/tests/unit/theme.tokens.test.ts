import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { DECK_TOKENS, deckThemeStyle } from "@/features/presentations/theme/DeckThemeProvider";

// A misspelt `deck-*` utility compiles to nothing and silently loses its
// colour, so every one used by the live surfaces must name a registered token.

const ROOT = resolve(import.meta.dir, "../..");
const TOKENS_CSS = readFileSync(join(ROOT, "features/presentations/theme/tokens.css"), "utf8");
const SCAN_DIRS = ["features/presentations", "app/live", "app/presentation/host"];

/** A colour utility (any variant prefix) on a deck colour: `hover:bg-deck-primary/20` → "primary". */
const DECK_UTILITY =
  /(?<=^|[\s"'`:])(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|from|via|to|shadow|accent|fill|stroke|outline|divide|decoration|caret)-deck-([a-z0-9-]+?)(?=[/\s"'`\]]|$)/gm;

const rootTokens =[...TOKENS_CSS.matchAll(/^\s*--deck-([a-z0-9-]+):/gm)].map((m) => m[1]);
const utilityColors = new Set([...TOKENS_CSS.matchAll(/--color-deck-([a-z0-9-]+):/g)].map((m) => m[1]));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("deck theme tokens", () => {
  test("DECK_TOKENS lists exactly the variables tokens.css defines", () => {
    expect<string[]>([...DECK_TOKENS].sort()).toEqual([...new Set(rootTokens)].sort());
  });

  test("every deck-* utility in the live surfaces names a registered colour", () => {
    const unknown: string[] = [];
    let seen = 0;
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        if (file.endsWith("tokens.css")) continue;
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(DECK_UTILITY)) {
          seen += 1;
          if (!utilityColors.has(match[1])) unknown.push(`${relative(ROOT, file)}: ${match[0]}`);
        }
      }
    }
    expect(unknown).toEqual([]);
    expect(seen).toBeGreaterThan(100); // the scan really sees the live UI
  });

  test("arbitrary var() references point at defined tokens", () => {
    const unknown: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        for (const match of readFileSync(file, "utf8").matchAll(/var\(--deck-([a-z0-9-]+)\)/g)) {
          if (!rootTokens.includes(match[1])) unknown.push(`${relative(ROOT, file)}: ${match[0]}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  test("deckThemeStyle maps known, non-empty tokens to CSS variables", () => {
    expect(deckThemeStyle()).toBeUndefined();
    expect(deckThemeStyle({ tokens: {} })).toBeUndefined();
    expect(
      deckThemeStyle({ tokens: { primary: "#123456", accent: " ", "not-a-token": "red" } as never })
    ).toEqual({ "--deck-primary": "#123456" } as never);
  });

  test("each deck mode defines every token, so a deck never falls back to the other mode's colours", () => {
    for (const mode of ["light", "dark"]) {
      const block = modeBlock(mode);
      const defined = [...block.matchAll(/^\s*--deck-([a-z0-9-]+):/gm)].map((m) => m[1]);
      expect([mode, [...new Set(defined)].sort()]).toEqual([mode, [...DECK_TOKENS].sort()]);
      // The app tokens inside the deck follow its mode too (Button, Input, text-muted-foreground…).
      for (const app of ["background", "foreground", "card", "primary", "primary-foreground", "muted-foreground", "border", "input", "success", "destructive", "info"]) {
        expect([mode, app, new RegExp(`--${app}:`).test(block)]).toEqual([mode, app, true]);
      }
    }
  });

  test("the light deck reads: text 4.5:1, marks and cloud words 3:1 on the paper stage and its panels", () => {
    const light = tokenValues(modeBlock("light"));
    const stage = light["stage-bg"]!;
    const panel = light["stage-panel"]!;
    for (const text of ["stage-fg", "stage-muted", "correct-soft", "danger-soft", "accent-soft", "rank-1", "rank-2", "rank-3", "info", "muted-fg", "primary-ink"]) {
      expect([text, ratio(light[text]!, stage) >= 4.5]).toEqual([text, true]);
      expect([text, ratio(light[text]!, panel) >= 4.5]).toEqual([text, true]);
    }
    for (const mark of ["accent", "correct", "wrong", "danger", "live", "bar"]) {
      expect([mark, ratio(light[mark]!, stage) >= 3]).toEqual([mark, true]);
    }
    for (let i = 1; i <= 12; i++) expect([`cloud-${i}`, ratio(light[`cloud-${i}`]!, stage) >= 4.5]).toEqual([`cloud-${i}`, true]);
    expect(ratio(light["stage-ink"]!, light.accent!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light["stage-ink"]!, light["accent-soft"]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light["primary-fg"]!, light.primary!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light.fg!, light.bg!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(light["qr-fg"]!, light["qr-bg"]!)).toBeGreaterThanOrEqual(7);
  });

  test("the dark deck reads the same way on graphite", () => {
    const dark = tokenValues(modeBlock("dark"));
    const stage = dark["stage-bg"]!;
    for (const text of ["stage-fg", "stage-muted", "correct-soft", "danger-soft", "accent-soft", "rank-1", "rank-2", "info", "muted-fg", "primary-ink"]) {
      expect([text, ratio(dark[text]!, stage) >= 4.5]).toEqual([text, true]);
      expect([text, ratio(dark[text]!, dark["stage-panel"]!) >= 4.5]).toEqual([text, true]);
    }
    for (let i = 1; i <= 12; i++) expect([`cloud-${i}`, ratio(dark[`cloud-${i}`]!, stage) >= 3]).toEqual([`cloud-${i}`, true]);
    expect(ratio(dark["stage-ink"]!, dark.accent!)).toBeGreaterThanOrEqual(4.5);
  });
});

/** The body of `[data-deck-mode="<mode>"] { … }` in tokens.css. */
function modeBlock(mode: string): string {
  const start = TOKENS_CSS.indexOf(`[data-deck-mode="${mode}"] {`);
  expect(start).toBeGreaterThan(-1);
  return TOKENS_CSS.slice(start, TOKENS_CSS.indexOf("\n}", start));
}

/** `--deck-x: #hex` → {x: "#hex"} (hex values only). */
function tokenValues(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--deck-([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\b/gi)].map((m) => [m[1], expandHex(m[2]!)]));
}

const expandHex = (hex: string) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex.toLowerCase());

function ratio(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = (o: number) => {
      const v = parseInt(hex.slice(o, o + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * c(1) + 0.7152 * c(3) + 0.0722 * c(5);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
