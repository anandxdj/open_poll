import type { PinImageContent } from "../../../types/deck";
import { clamp, configOf, countOf, distributionOfKind, finite, record, roundTo, text } from "../../advanced/read";

// pin_on_image settings: the image in `slide.content`, the optional correct
// area in `slide.config.region` (backend/src/modules/presentations/slides/
// types/advanced/pin_on_image.ts). Coordinates are fractions of the image,
// 0–1 from the left (`x`) and from the top (`y`). Shared by the editor, the
// participant view and the stage: no editor code.

/** Smallest correct-area side, as a share of the image. */
export const MIN_REGION_SIZE = 0.01;
/** The heatmap counts pins per cell of a HEAT_GRID × HEAT_GRID grid over the image. */
export const HEAT_GRID = 20;
/** Pins and regions are kept to 4 decimal places of the image size. */
export const COORD_DECIMALS = 4;

/** A rectangle on the image. */
export type PinRegion = { x: number; y: number; width: number; height: number };
export type Pin = { x: number; y: number };

const EPSILON = 1e-9;

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

/** The image of a slide (deck slide or live slide), with blanks for anything missing. */
export function readPinImage(content: unknown): PinImageContent {
  const c = record(content);
  return { key: textOrNull(c.key), url: textOrNull(c.url), alt: text(c.alt) };
}

export const pinImageOf = (slide: object): PinImageContent => readPinImage((slide as { content?: unknown }).content);

/** `region` when it is a well-formed rectangle inside the image, else null (also for malformed stored values). */
export function readRegion(value: unknown): PinRegion | null {
  const r = record(value);
  const x = finite(r.x) ?? -1;
  const y = finite(r.y) ?? -1;
  const width = finite(r.width) ?? 0;
  const height = finite(r.height) ?? 0;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) return null;
  if (x + width > 1 + EPSILON || y + height > 1 + EPSILON) return null;
  return { x, y, width, height };
}

/** The stored correct area, or null. */
export const pinRegion = (slide: object): PinRegion | null => readRegion(configOf(slide).region);

/** The stored area as typed, even while it is out of bounds (for the editor). */
export const rawRegion = (slide: object): PinRegion | null => {
  const r = record(configOf(slide).region);
  const x = finite(r.x);
  const y = finite(r.y);
  const width = finite(r.width);
  const height = finite(r.height);
  return x === null || y === null || width === null || height === null ? null : { x, y, width, height };
};

/** First problem with a correct area (a save-time message, lowercase, unprefixed), or null. */
export function regionIssue(region: PinRegion): string | null {
  const { x, y, width, height } = region;
  if (width < MIN_REGION_SIZE || height < MIN_REGION_SIZE) return "the correct area is too small.";
  if (x < 0 || y < 0 || x > 1 || y > 1 || width > 1 || height > 1) return "the correct area must lie inside the image.";
  if (x + width > 1 + EPSILON || y + height > 1 + EPSILON) return "the correct area must lie inside the image.";
  return null;
}

export const roundRegion = (r: PinRegion): PinRegion => ({
  x: roundTo(r.x, COORD_DECIMALS),
  y: roundTo(r.y, COORD_DECIMALS),
  width: roundTo(r.width, COORD_DECIMALS),
  height: roundTo(r.height, COORD_DECIMALS),
});

/** The rectangle spanned by two corners (fractions of the image), kept inside it. */
export function regionBetween(a: Pin, b: Pin): PinRegion {
  const x1 = clamp(Math.min(a.x, b.x), 0, 1);
  const y1 = clamp(Math.min(a.y, b.y), 0, 1);
  const x2 = clamp(Math.max(a.x, b.x), 0, 1);
  const y2 = clamp(Math.max(a.y, b.y), 0, 1);
  return roundRegion({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
}

/** Whether a pin lies in the area (edges count). */
export const isInsideRegion = (region: PinRegion, pin: Pin) =>
  pin.x >= region.x - EPSILON &&
  pin.x <= region.x + region.width + EPSILON &&
  pin.y >= region.y - EPSILON &&
  pin.y <= region.y + region.height + EPSILON;

/** A pin at fractions `fx`, `fy` of the image, kept inside it and to the stored precision. */
export const pinAt = (fx: number, fy: number): Pin => ({
  x: roundTo(clamp(fx, 0, 1), COORD_DECIMALS),
  y: roundTo(clamp(fy, 0, 1), COORD_DECIMALS),
});

/** One keyboard step moves the cursor this share of the image (Shift: five steps). */
export const CURSOR_STEP = 0.02;

export type CursorDirection = "left" | "right" | "up" | "down";

/** The keyboard cursor moved one step (or five) in `direction`; the centre when there was none. */
export function moveCursor(from: Pin | null, direction: CursorDirection, big = false): Pin {
  const start = from ?? { x: 0.5, y: 0.5 };
  const step = CURSOR_STEP * (big ? 5 : 1);
  return pinAt(
    start.x + (direction === "left" ? -step : direction === "right" ? step : 0),
    start.y + (direction === "up" ? -step : direction === "down" ? step : 0)
  );
}

/** `fraction` as a percentage text ("42%"). */
export const percentText = (fraction: number) => `${Math.round(fraction * 100)}%`;

// ---------- Results ----------

export interface HeatCell {
  col: number;
  row: number;
  count: number;
}

export interface PinDistribution {
  /** Every pin counted, including those beyond the newest ones listed in `pins`. */
  count: number;
  /** The newest pins, capped by the server. */
  pins: Pin[];
  heat: { size: number; cells: HeatCell[] };
  /** The correct area, or null when the slide has none. */
  region: PinRegion | null;
  inRegion: number | null;
}

/** The server's results, or null when `value` is not a pin_on_image distribution. */
export function parsePinDistribution(value: unknown): PinDistribution | null {
  const d = distributionOfKind(value, "pin_on_image");
  if (!d) return null;
  const pins = (Array.isArray(d.pins) ? d.pins : []).flatMap((entry): Pin[] => {
    const p = record(entry);
    const x = finite(p.x);
    const y = finite(p.y);
    return x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [{ x, y }] : [];
  });
  const heat = record(d.heat);
  const size = Math.max(1, countOf(heat.size) || HEAT_GRID);
  const cells = (Array.isArray(heat.cells) ? heat.cells : []).flatMap((entry): HeatCell[] => {
    const cell = record(entry);
    const col = finite(cell.col);
    const row = finite(cell.row);
    const count = countOf(cell.count);
    return col !== null && row !== null && count > 0 && col >= 0 && col < size && row >= 0 && row < size
      ? [{ col: Math.floor(col), row: Math.floor(row), count }]
      : [];
  });
  return {
    count: countOf(d.count),
    pins,
    heat: { size, cells },
    region: readRegion(d.region),
    inRegion: finite(d.inRegion),
  };
}

export const emptyPinDistribution = (region: PinRegion | null): PinDistribution => ({
  count: 0,
  pins: [],
  heat: { size: HEAT_GRID, cells: [] },
  region,
  inRegion: null,
});
