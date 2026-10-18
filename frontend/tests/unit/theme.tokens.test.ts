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
});
