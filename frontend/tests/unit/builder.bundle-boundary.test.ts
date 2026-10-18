import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// Participants and the stage must never download builder code. Walks the
// runtime import graph (type-only imports are skipped: they ship no code)
// from every live entry point and fails if it reaches an editor module.

const ROOT = resolve(import.meta.dir, "../..");

const LIVE_ENTRY_DIRS = ["app/live", "app/presentation/host", "app/p"];
const SHARED_ENTRIES = ["app/layout.tsx", "features/presentations/slides/meta.ts"];

const FORBIDDEN = [
  /^features\/presentations\/slides\/editor\.ts$/,
  /^features\/presentations\/slides\/editorKit\.tsx$/,
  /^features\/presentations\/slides\/types\/[^/]+\/editor\.tsx$/,
  /^features\/presentations\/components\/builder\//,
];

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];
const IMPORT_RE = /(?:^|[\s;])(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null; // package import
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    if (!match[2]) specifiers.push(match[3]);
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) specifiers.push(match[1]);
  return specifiers
    .map((specifier) => resolveSpecifier(file, specifier))
    .filter((path): path is string => path !== null && /\.(ts|tsx)$/.test(path));
}

/** Returns the import chain to the first forbidden module, or null. */
function findForbidden(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: { file: string; chain: string[] }[] = [{ file: entry, chain: [relative(ROOT, entry)] }];
  while (stack.length > 0) {
    const { file, chain } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = relative(ROOT, file);
    if (FORBIDDEN.some((re) => re.test(rel))) return chain;
    for (const next of runtimeImports(file)) {
      stack.push({ file: next, chain: [...chain, relative(ROOT, next)] });
    }
  }
  return null;
}

function listSourceFiles(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .map((name) => join(abs, name));
}

const entries = [
  ...LIVE_ENTRY_DIRS.flatMap(listSourceFiles),
  ...SHARED_ENTRIES.map((file) => join(ROOT, file)),
];

describe("live bundles exclude editor code", () => {
  test("found the live entry points", () => {
    expect(entries.some((file) => file.includes("app/live/"))).toBe(true);
    expect(entries.some((file) => file.includes("app/presentation/host/"))).toBe(true);
  });

  for (const entry of entries) {
    test(relative(ROOT, entry), () => {
      expect(findForbidden(entry)).toBeNull();
    });
  }

  test("the walker does catch the builder", () => {
    const builder = join(ROOT, "features/presentations/components/PresentationBuilder.tsx");
    expect(findForbidden(builder)).not.toBeNull();
  });
});
