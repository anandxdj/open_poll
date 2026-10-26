import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { questionLabel } from '../../fields';
import { hincrby, lpushTrim, rejectAnswer } from '../../ops';
import type { RedisOp, Slide } from '../../types';
import { configOf, finiteOr, payloadOf, recordOf, roundTo, textItems, textOr, unscoredSlideSchema } from './shared';

export const MAX_GRID_ITEMS = 10;
/** Newest participants whose placements the stage draws as dots (each one's positions for every item). */
export const GRID_FEED_LENGTH = 200;
/** Longest corner name. */
export const MAX_QUADRANT_LABEL = 40;
/** Largest absolute axis bound. */
export const GRID_AXIS_LIMIT = 1000;
/**
 * Positions are kept to 2 decimal places; the per-item sums are stored in
 * hundredths so `hincrby` (integers only) can add them up.
 */
const POSITION_SCALE = 100;

export interface GridAxis {
  label: string;
  min: number;
  max: number;
}

/** Optional names for the four corners of the board (e.g. "Quick wins"); empty = unnamed. */
export interface GridQuadrants {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
}

export interface Grid2x2Settings {
  items: string[];
  x: GridAxis;
  y: GridAxis;
  quadrants: GridQuadrants;
}

const DEFAULT_AXIS = { min: 0, max: 10 };

const axisSchema = (name: 'Horizontal' | 'Vertical') =>
  z
    .object({
      label: z.string().trim().min(1, `${name} axis label is required`).max(40).prefault(''),
      min: z.number().int().min(-GRID_AXIS_LIMIT).max(GRID_AXIS_LIMIT).default(DEFAULT_AXIS.min),
      max: z.number().int().min(-GRID_AXIS_LIMIT).max(GRID_AXIS_LIMIT).default(DEFAULT_AXIS.max),
    })
    .superRefine((axis, ctx) => {
      if (axis.max <= axis.min) {
        ctx.addIssue({ code: 'custom', path: ['max'], message: `${name} axis max must be greater than its min` });
      }
    })
    .prefault({});

const quadrantLabel = z.string().trim().max(MAX_QUADRANT_LABEL, `Keep corner names under ${MAX_QUADRANT_LABEL} characters`).default('');

const quadrantsSchema = z
  .object({ topLeft: quadrantLabel, topRight: quadrantLabel, bottomLeft: quadrantLabel, bottomRight: quadrantLabel })
  .prefault({});

export const grid2x2SettingsSchema = z.object({
  items: z
    .array(z.string().trim().min(1, 'Item text is required').max(200))
    .min(1, '2x2 grid slides need at least 1 item')
    .max(MAX_GRID_ITEMS, `2x2 grid slides take at most ${MAX_GRID_ITEMS} items`)
    .prefault([]),
  x: axisSchema('Horizontal'),
  y: axisSchema('Vertical'),
  quadrants: quadrantsSchema,
});

const axisOf = (value: unknown, fallbackLabel: string): GridAxis => {
  const a = recordOf(value);
  const min = finiteOr(a.min, DEFAULT_AXIS.min);
  const max = finiteOr(a.max, DEFAULT_AXIS.max);
  return {
    label: textOr(a.label, fallbackLabel) || fallbackLabel,
    ...(max > min ? { min, max } : DEFAULT_AXIS),
  };
};

const quadrantsOf = (value: unknown): GridQuadrants => {
  const q = recordOf(value);
  const name = (v: unknown) => textOr(v, '').slice(0, MAX_QUADRANT_LABEL);
  return { topLeft: name(q.topLeft), topRight: name(q.topRight), bottomLeft: name(q.bottomLeft), bottomRight: name(q.bottomRight) };
};

/** Stored settings with defaults (malformed axes fall back to 0–10; corners unnamed). */
export const grid2x2Settings = (slide: Pick<Slide, 'config'>): Grid2x2Settings => {
  const c = configOf(slide);
  return {
    items: textItems(c.items),
    x: axisOf(c.x, 'Horizontal'),
    y: axisOf(c.y, 'Vertical'),
    quadrants: quadrantsOf(c.quadrants),
  };
};

/** A feed entry (one participant's `x,y` per item, `;`-separated) back to positions; null when malformed. */
const parsePlacement = (entry: string, itemCount: number): { x: number; y: number }[] | null => {
  const positions = entry.split(';').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return Number.isFinite(x) && Number.isFinite(y) ? { x: x!, y: y! } : null;
  });
  return positions.length === itemCount && positions.every((p) => p !== null) ? (positions as { x: number; y: number }[]) : null;
};

interface Grid2x2Config {
  itemCount: number;
  x: { min: number; max: number };
  y: { min: number; max: number };
}

const answerSchema = z.object({
  positions: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .max(MAX_GRID_ITEMS)
    .optional(),
});

const label = questionLabel('2x2 grid');

const inRange = (value: number, axis: { min: number; max: number }) => value >= axis.min && value <= axis.max;

const average = (sumHundredths: number, count: number) =>
  count > 0 ? roundTo(sumHundredths / POSITION_SCALE / count, 2) : null;

/**
 * Each participant places every item on two axes (e.g. effort × impact,
 * each with its own min…max); never scored. The four corners may be named.
 * Results: the average position of each item (+ how many placed it) and the
 * newest participants' own placements, drawn as a 2x2 scatter on the stage.
 */
export const grid2x2Slide = defineSlideType<Grid2x2Config, z.infer<typeof answerSchema>>({
  type: 'grid_2x2',
  name: '2x2 grid',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: unscoredSlideSchema('grid_2x2', grid2x2SettingsSchema.prefault({})),
  sanitize: (slide) => {
    const { items, x, y, quadrants } = grid2x2Settings(slide);
    return { question: slide.question, timeLimit: slide.timeLimit, config: { items, x, y, quadrants } };
  },
  acceptConfig: (slide) => {
    const { items, x, y } = grid2x2Settings(slide);
    return { itemCount: items.length, x: { min: x.min, max: x.max }, y: { min: y.min, max: y.max } };
  },
  answerSchema,
  accept: (cfg, { positions }) => {
    if (!positions || positions.length !== cfg.itemCount) rejectAnswer(`Place each of the ${cfg.itemCount} items`);
    if (positions.some((p) => !inRange(p.x, cfg.x))) {
      rejectAnswer(`Horizontal positions must be between ${cfg.x.min} and ${cfg.x.max}`);
    }
    if (positions.some((p) => !inRange(p.y, cfg.y))) {
      rejectAnswer(`Vertical positions must be between ${cfg.y.min} and ${cfg.y.max}`);
    }
    const placed = positions.map((p) => ({ x: roundTo(p.x, 2), y: roundTo(p.y, 2) }));
    const ops: RedisOp[] = placed.flatMap((p, i) => [
      hincrby('dist', `i:${i}:x`, Math.round(p.x * POSITION_SCALE)),
      hincrby('dist', `i:${i}:y`, Math.round(p.y * POSITION_SCALE)),
      hincrby('dist', `i:${i}:n`),
    ]);
    ops.push(hincrby('dist', 'voters'));
    ops.push(lpushTrim('feed', placed.map((p) => `${p.x},${p.y}`).join(';'), GRID_FEED_LENGTH));
    return { isCorrect: false, ops, persist: { optionIndex: null, text: null, payload: { positions: placed } } };
  },
  feedLength: GRID_FEED_LENGTH,
  distribution: (slide, { dist, feed }) => {
    const { items, x, y, quadrants } = grid2x2Settings(slide);
    return {
      kind: 'grid_2x2',
      x,
      y,
      quadrants,
      items: items.map((text, i) => {
        const count = Number(dist[`i:${i}:n`] ?? 0);
        return {
          text,
          x: average(Number(dist[`i:${i}:x`] ?? 0), count),
          y: average(Number(dist[`i:${i}:y`] ?? 0), count),
          count,
        };
      }),
      voters: Number(dist['voters'] ?? 0),
      // Newest first, each one participant's positions in item order.
      placements: feed
        .map((entry) => parsePlacement(entry, items.length))
        .filter((p): p is { x: number; y: number }[] => p !== null),
    };
  },
  exportColumns: (slide) => {
    const { items, x, y } = grid2x2Settings(slide);
    return items.flatMap((item) => [`${label(slide)} — ${item} (${x.label})`, `${label(slide)} — ${item} (${y.label})`]);
  },
  exportCells: (slide, answer) => {
    const positions = payloadOf(answer).positions;
    return grid2x2Settings(slide).items.flatMap((_, i) => {
      const p = Array.isArray(positions) ? recordOf(positions[i]) : {};
      return [typeof p.x === 'number' ? p.x : null, typeof p.y === 'number' ? p.y : null];
    });
  },
  label,
});

registerSlideType(grid2x2Slide);
