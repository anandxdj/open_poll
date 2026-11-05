import { clamp, configOf, countOf, distributionOfKind, finite, numberOr, record, roundTo, text, textList } from "../../advanced/read";

// grid_2x2 settings (`slide.config`), the answer rules and the results shape
// (backend/src/modules/presentations/slides/types/advanced/grid_2x2.ts).
// Shared by the editor, the participant board and the stage: no editor code.

export const MIN_GRID_ITEMS = 1;
export const MAX_GRID_ITEMS = 10;
/** Largest absolute axis bound. */
export const GRID_AXIS_LIMIT = 1000;
export const MAX_AXIS_LABEL = 40;
export const MAX_QUADRANT_LABEL = 40;

export type GridAxis = { label: string; min: number; max: number };
/** Optional names for the board's corners (e.g. "Quick wins"); empty = unnamed. */
export type GridQuadrants = { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string };
export type Grid2x2Config = { items: string[]; x: GridAxis; y: GridAxis; quadrants: GridQuadrants };

export const QUADRANT_KEYS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
export const NO_QUADRANTS: GridQuadrants = { topLeft: "", topRight: "", bottomLeft: "", bottomRight: "" };
/** A place on the grid, in axis units. */
export type GridPosition = { x: number; y: number };

export const DEFAULT_AXIS_RANGE = { min: 0, max: 10 } as const;
const FALLBACK_LABEL = { x: "Horizontal", y: "Vertical" } as const;

const rawAxis = (value: unknown): GridAxis => {
  const a = record(value);
  return { label: text(a.label), min: numberOr(a.min, DEFAULT_AXIS_RANGE.min), max: numberOr(a.max, DEFAULT_AXIS_RANGE.max) };
};

const rawQuadrants = (value: unknown): GridQuadrants => {
  const q = record(value);
  return { topLeft: text(q.topLeft), topRight: text(q.topRight), bottomLeft: text(q.bottomLeft), bottomRight: text(q.bottomRight) };
};

const viewQuadrants = (q: GridQuadrants): GridQuadrants => ({
  topLeft: q.topLeft.trim(),
  topRight: q.topRight.trim(),
  bottomLeft: q.bottomLeft.trim(),
  bottomRight: q.bottomRight.trim(),
});

/** The stored settings as they are, each field on its own fallback: for the editor, which edits one field at a time. */
export function rawGridConfig(slide: object): Grid2x2Config {
  const c = configOf(slide);
  return { items: textList(c.items), x: rawAxis(c.x), y: rawAxis(c.y), quadrants: rawQuadrants(c.quadrants) };
}

const viewAxis = (axis: GridAxis, fallbackLabel: string): GridAxis => ({
  label: axis.label.trim() || fallbackLabel,
  ...(axis.max > axis.min ? { min: axis.min, max: axis.max } : DEFAULT_AXIS_RANGE),
});

/** Settings for the views: nameless axes get a label and a broken range falls back to 0–10, like the backend. */
export function gridConfig(slide: object): Grid2x2Config {
  const raw = rawGridConfig(slide);
  return {
    items: raw.items,
    x: viewAxis(raw.x, FALLBACK_LABEL.x),
    y: viewAxis(raw.y, FALLBACK_LABEL.y),
    quadrants: viewQuadrants(raw.quadrants),
  };
}

/** A corner name that is too long (a save-time message, lowercase, unprefixed), or null. */
export function quadrantIssue(quadrants: GridQuadrants): string | null {
  const long = QUADRANT_KEYS.some((key) => quadrants[key].trim().length > MAX_QUADRANT_LABEL);
  return long ? `keep corner names under ${MAX_QUADRANT_LABEL} characters.` : null;
}

/** First problem with one axis (a save-time message, lowercase, unprefixed), or null. */
export function axisIssue(axis: GridAxis, name: "horizontal" | "vertical"): string | null {
  if (!axis.label.trim()) return `name the ${name} axis.`;
  if (axis.label.trim().length > MAX_AXIS_LABEL) return `keep the ${name} axis name under ${MAX_AXIS_LABEL} characters.`;
  if (![axis.min, axis.max].every((v) => Number.isInteger(v))) return `the ${name} axis needs whole numbers.`;
  if (Math.abs(axis.min) > GRID_AXIS_LIMIT || Math.abs(axis.max) > GRID_AXIS_LIMIT) {
    return `the ${name} axis must stay between -${GRID_AXIS_LIMIT} and ${GRID_AXIS_LIMIT}.`;
  }
  if (axis.max <= axis.min) return `the ${name} axis max must be greater than its min.`;
  return null;
}

// ---------- Positions ----------

/** Positions are kept to 2 decimal places, like the server stores them. */
export const roundPosition = (p: GridPosition): GridPosition => ({ x: roundTo(p.x, 2), y: roundTo(p.y, 2) });

/** Where `p` sits on a board, as fractions from the left (`fx`) and the bottom (`fy`), 0–1. */
export const fractionOf = (p: GridPosition, x: GridAxis, y: GridAxis) => ({
  fx: clamp((p.x - x.min) / (x.max - x.min), 0, 1),
  fy: clamp((p.y - y.min) / (y.max - y.min), 0, 1),
});

/** The position at fractions `fx` (from the left) and `fy` (from the bottom) of the board. */
export const positionAt = (fx: number, fy: number, x: GridAxis, y: GridAxis): GridPosition =>
  roundPosition({
    x: x.min + clamp(fx, 0, 1) * (x.max - x.min),
    y: y.min + clamp(fy, 0, 1) * (y.max - y.min),
  });

/** The middle of the board. */
export const centerPosition = (x: GridAxis, y: GridAxis): GridPosition => positionAt(0.5, 0.5, x, y);

/** One keyboard step is this share of each axis (Shift moves five times as far). */
export const NUDGE_FRACTION = 1 / 20;

export type Direction = "left" | "right" | "up" | "down";

/** `from` moved one step (`big`: five steps) in `direction`, or the centre when nothing was placed yet. */
export function nudgePosition(from: GridPosition | null, direction: Direction, x: GridAxis, y: GridAxis, big = false): GridPosition {
  const start = from ?? centerPosition(x, y);
  const { fx, fy } = fractionOf(start, x, y);
  const step = NUDGE_FRACTION * (big ? 5 : 1);
  const dx = direction === "left" ? -step : direction === "right" ? step : 0;
  const dy = direction === "down" ? -step : direction === "up" ? step : 0;
  return positionAt(fx + dx, fy + dy, x, y);
}

/** Index of the first item without a position at or after `from` (wrapping), or null when all are placed. */
export function nextUnplaced(positions: (GridPosition | null)[], from = 0): number | null {
  const n = positions.length;
  for (let k = 0; k < n; k++) {
    const i = (from + k) % n;
    if (positions[i] === null) return i;
  }
  return null;
}

/** The answer when every item is placed, else null. */
export const completePositions = (positions: (GridPosition | null)[]): GridPosition[] | null =>
  positions.every((p): p is GridPosition => p !== null) ? positions.map(roundPosition) : null;

// ---------- Results ----------

export interface GridItemResult {
  text: string;
  /** Average position of the item; null while nobody placed it. */
  x: number | null;
  y: number | null;
  count: number;
}

export interface Grid2x2Distribution {
  x: GridAxis;
  y: GridAxis;
  quadrants: GridQuadrants;
  items: GridItemResult[];
  voters: number;
  /** The newest participants' own placements (each one's position per item, in item order). */
  placements: GridPosition[][];
}

const positionOf = (value: unknown): GridPosition | null => {
  const p = record(value);
  const x = finite(p.x);
  const y = finite(p.y);
  return x === null || y === null ? null : { x, y };
};

/** The server's results, or null when `value` is not a grid_2x2 distribution. */
export function parseGridDistribution(value: unknown): Grid2x2Distribution | null {
  const d = distributionOfKind(value, "grid_2x2");
  if (!d) return null;
  return {
    x: viewAxis(rawAxis(d.x), FALLBACK_LABEL.x),
    y: viewAxis(rawAxis(d.y), FALLBACK_LABEL.y),
    quadrants: viewQuadrants(rawQuadrants(d.quadrants)),
    items: (Array.isArray(d.items) ? d.items : []).map((entry): GridItemResult => {
      const item = record(entry);
      return { text: text(item.text), x: finite(item.x), y: finite(item.y), count: countOf(item.count) };
    }),
    voters: countOf(d.voters),
    placements: (Array.isArray(d.placements) ? d.placements : []).flatMap((entry) => {
      if (!Array.isArray(entry)) return [];
      const positions = entry.map(positionOf);
      return positions.every((p): p is GridPosition => p !== null) ? [positions] : [];
    }),
  };
}

/** No answers yet: the configured items on their axes with nothing plotted. */
export function emptyGridDistribution(config: Grid2x2Config): Grid2x2Distribution {
  return {
    x: config.x,
    y: config.y,
    quadrants: config.quadrants,
    items: config.items.map((item) => ({ text: item, x: null, y: null, count: 0 })),
    voters: 0,
    placements: [],
  };
}

/**
 * The placed item nearest to the point (`fx` from the left, `fy` from the bottom)
 * within `radius` of the board's size, or null: grabs a marker under the pointer.
 */
export function nearestPlaced(
  positions: (GridPosition | null)[],
  fx: number,
  fy: number,
  x: GridAxis,
  y: GridAxis,
  radius = 0.07
): number | null {
  let best: number | null = null;
  let bestDistance = radius;
  positions.forEach((p, i) => {
    if (!p) return;
    const at = fractionOf(p, x, y);
    const distance = Math.hypot(at.fx - fx, at.fy - fy);
    if (distance <= bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}
