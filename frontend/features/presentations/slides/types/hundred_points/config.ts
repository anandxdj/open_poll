import { clamp, configOf, countOf, distributionOfKind, finite, record, roundTo, text, textList } from "../../advanced/read";

// hundred_points settings (`slide.config`), the answer rules and the results
// shape (backend/src/modules/presentations/slides/types/advanced/hundred_points.ts).
// Shared by the editor, the participant form and the stage: no editor code.

/** Points every participant distributes. */
export const HUNDRED_POINTS_TOTAL = 100;
export const MIN_POINT_ITEMS = 2;
export const MAX_POINT_ITEMS = 10;

/** The items to share points over, as stored (blank entries included while editing). */
export const hundredPointsItems = (slide: object): string[] => textList(configOf(slide).items);

export const sumPoints = (points: number[]) => points.reduce((total, p) => total + p, 0);

/** Points still to give (negative when over-allocated). */
export const remainingPoints = (points: number[]) => HUNDRED_POINTS_TOTAL - sumPoints(points);

/** A whole number from 0 to 100 (anything else becomes the nearest one; NaN becomes 0). */
export const toPointValue = (raw: number): number =>
  Number.isFinite(raw) ? clamp(Math.round(raw), 0, HUNDRED_POINTS_TOTAL) : 0;

/** `points` with item `index` set to `raw` (a whole number 0–100). */
export const withPoints = (points: number[], index: number, raw: number): number[] =>
  points.map((p, i) => (i === index ? toPointValue(raw) : p));

/**
 * Like `withPoints`, but never giving out more than is left: the slider and
 * the ±5 buttons stop at 100 in total.
 */
export function withPointsWithinTotal(points: number[], index: number, raw: number): number[] {
  const others = sumPoints(points) - (points[index] ?? 0);
  return withPoints(points, index, Math.min(toPointValue(raw), HUNDRED_POINTS_TOTAL - others));
}

/** Whether `points` is a valid answer for `itemCount` items: whole, none negative, exactly 100. */
export const isCompleteAnswer = (points: number[], itemCount: number) =>
  points.length === itemCount &&
  points.every((p) => Number.isInteger(p) && p >= 0) &&
  sumPoints(points) === HUNDRED_POINTS_TOTAL;

export interface PointsItemResult {
  text: string;
  total: number;
  average: number;
}

export interface HundredPointsDistribution {
  items: PointsItemResult[];
  voters: number;
}

/** The server's results, or null when `value` is not a hundred_points distribution. */
export function parseHundredPointsDistribution(value: unknown): HundredPointsDistribution | null {
  const d = distributionOfKind(value, "hundred_points");
  if (!d) return null;
  const items = (Array.isArray(d.items) ? d.items : []).map((entry): PointsItemResult => {
    const item = record(entry);
    return { text: text(item.text), total: countOf(item.total), average: Math.max(0, finite(item.average) ?? 0) };
  });
  return { items, voters: countOf(d.voters) };
}

/** No answers yet: every item at 0. */
export const emptyHundredPointsDistribution = (items: string[]): HundredPointsDistribution => ({
  items: items.map((item) => ({ text: item, total: 0, average: 0 })),
  voters: 0,
});

/** Average points as shown ("35", "33.3"). */
export const formatAverage = (average: number) => String(roundTo(average, 1));
