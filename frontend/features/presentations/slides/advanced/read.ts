// Defensive readers shared by the advanced interactive types (guess_number,
// hundred_points, grid_2x2, pin_on_image). A slide's `config` and the results
// distribution arrive from the API, a local draft or a live event, so every
// read falls back to a blank value instead of trusting the shape. Runtime-safe:
// no editor code (the builder-only pieces are in `./editorFields.tsx`).

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

export const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const numberOr = (value: unknown, fallback: number): number => finite(value) ?? fallback;

export const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

/** A non-negative whole number (counts), else 0. */
export const countOf = (value: unknown): number => {
  const n = finite(value);
  return n !== null && n > 0 ? Math.floor(n) : 0;
};

/** The `config` of a deck slide or of a live (participant) slide. */
export const configOf = (slide: object): Record<string, unknown> => record((slide as { config?: unknown }).config);

/** The distribution object when it is of `kind`, else null. */
export const distributionOfKind = (value: unknown, kind: string): Record<string, unknown> | null => {
  const dist = record(value);
  return dist.kind === kind ? dist : null;
};

/** Decimal places of a finite number as written (`0.25` → 2, `1e-7` → 7). */
export const decimalsOf = (value: number): number => {
  const [mantissa = "", exponent] = String(value).toLowerCase().split("e");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent ?? 0));
};

/** `value` rounded to `decimals` places, without float noise. */
export const roundTo = (value: number, decimals: number): number => Number(value.toFixed(Math.min(decimals, 20)));

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Locale-independent number text (the same on the server and in the browser). */
export const formatNumber = (value: number, maxFractionDigits = 2): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: maxFractionDigits }).format(value);

/** `n` as a percentage of `total` (0 when there is no total), 0–100. */
export const percentOf = (n: number, total: number): number => (total > 0 ? clamp((n / total) * 100, 0, 100) : 0);

/**
 * A pointer position as fractions of an element's box (`fx` from the left,
 * `fy` from the top), clamped to 0–1. A zero-sized box reads as the centre.
 */
export const pointerFraction = (
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number
): { fx: number; fy: number } => ({
  fx: box.width > 0 ? clamp((clientX - box.left) / box.width, 0, 1) : 0.5,
  fy: box.height > 0 ? clamp((clientY - box.top) / box.height, 0, 1) : 0.5,
});
