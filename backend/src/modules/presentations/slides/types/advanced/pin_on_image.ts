import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { questionLabel } from '../../fields';
import { hincrby, lpushTrim, rejectAnswer, speedScore } from '../../ops';
import type { RedisOp, Slide } from '../../types';
import {
  IMAGE_EXTENSIONS,
  httpsUrlSchema,
  mediaUrlOf,
  publicUrlOf,
  storageDisabledMessage,
  storageKeySchema,
} from '../content/media';
import { contentOf, requiredText, textField } from '../content/shared';
import {
  configOf,
  finiteOr,
  gradableSlideSchema,
  isWorthPoints,
  payloadOf,
  recordOf,
  requireTimerWhenGraded,
  roundTo,
} from './shared';

/** Newest pins kept for the stage overlay (`lpush_trim`); counts cover every pin. */
export const PIN_FEED_LENGTH = 500;
/** The heatmap counts pins per cell of a HEAT_GRID × HEAT_GRID grid over the image. */
export const HEAT_GRID = 20;
/** Pins and regions are kept to 4 decimal places of the image size. */
const COORD_DECIMALS = 4;
/** Smallest region side, as a share of the image. */
export const MIN_REGION_SIZE = 0.01;

/** A rectangle in image coordinates: [0,1] from the left/top edge. */
export interface PinRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const unit = z.number().min(0).max(1);

export const pinRegionSchema = z
  .object({
    x: unit,
    y: unit,
    width: z.number().min(MIN_REGION_SIZE, 'The correct area is too small').max(1),
    height: z.number().min(MIN_REGION_SIZE, 'The correct area is too small').max(1),
  })
  .superRefine((r, ctx) => {
    if (r.x + r.width > 1 + 1e-9 || r.y + r.height > 1 + 1e-9) {
      ctx.addIssue({ code: 'custom', message: 'The correct area must lie inside the image' });
    }
  })
  .transform((r) => ({
    x: roundTo(r.x, COORD_DECIMALS),
    y: roundTo(r.y, COORD_DECIMALS),
    width: roundTo(r.width, COORD_DECIMALS),
    height: roundTo(r.height, COORD_DECIMALS),
  }));

export const pinSettingsSchema = z.object({
  /** The correct area; null = no correct area (results only, never scored). */
  region: pinRegionSchema.nullable().default(null),
});

/** The image, like the image content type: an upload `key` (URL pinned to it) or a pasted https `url`. */
const pinImageSchema = z
  .object({
    key: storageKeySchema(IMAGE_EXTENSIONS, 'Not an uploaded image'),
    url: httpsUrlSchema('Image URL must start with https://'),
    alt: requiredText(500, 'Alt text is required: describe the image for people who cannot see it').prefault(''),
  })
  .superRefine((image, ctx) => {
    if (image.key && !publicUrlOf(image.key)) {
      ctx.addIssue({ code: 'custom', path: ['key'], message: storageDisabledMessage });
    }
  })
  // With neither a key nor a URL the slide is a placeholder (drafts).
  .transform((image) => (image.key ? { ...image, url: publicUrlOf(image.key) } : image));

/** The stored correct region, or null (also for malformed stored values). */
export const pinRegion = (slide: Pick<Slide, 'config'>): PinRegion | null => {
  const r = recordOf(configOf(slide).region);
  const x = finiteOr(r.x, -1);
  const y = finiteOr(r.y, -1);
  const width = finiteOr(r.width, 0);
  const height = finiteOr(r.height, 0);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) return null;
  return { x, y, width, height };
};

const isInside = (r: PinRegion, x: number, y: number) =>
  x >= r.x - 1e-9 && x <= r.x + r.width + 1e-9 && y >= r.y - 1e-9 && y <= r.y + r.height + 1e-9;

/** Graded: worth points and has a correct area. Otherwise results only. */
const isGraded = (slide: Pick<Slide, 'points' | 'config'>) => isWorthPoints(slide) && pinRegion(slide) !== null;

interface PinConfig {
  region: PinRegion | null;
  points: number;
  scoreDependsOnTime: boolean;
  timeLimitMs: number;
}

const answerSchema = z.object({ x: z.number().optional(), y: z.number().optional() });

const label = questionLabel('Pin on image');

const heatCell = (value: number) => Math.min(HEAT_GRID - 1, Math.floor(value * HEAT_GRID));

/** A feed entry `"x,y"` back to a pin; null when malformed. */
const parsePin = (entry: string): { x: number; y: number } | null => {
  const [x, y] = entry.split(',').map(Number);
  return x !== undefined && y !== undefined && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
};

/**
 * Participants drop one pin on an image (x, y in [0,1] of the image size).
 * With a correct area a pin inside it is correct and, when the slide is worth
 * points, scores like select_answer. Results: the newest pins (capped list),
 * a heatmap of all pins, and how many landed in the area.
 */
export const pinOnImageSlide = defineSlideType<PinConfig, z.infer<typeof answerSchema>>({
  type: 'pin_on_image',
  name: 'Pin on image',
  kind: 'interactive',
  lifecycle: 'response',
  scored: true,
  isScored: isGraded,
  schema: gradableSlideSchema('pin_on_image', pinSettingsSchema.prefault({}))
    .extend({ content: pinImageSchema.prefault({}) })
    .superRefine((slide, ctx) =>
      requireTimerWhenGraded(slide.points > 0 && slide.config.region !== null, slide.timeLimit, ctx)
    ),
  // Participants get the image URL and alt text only: never the storage key or the correct area.
  sanitize: (slide) => ({
    question: slide.question,
    timeLimit: slide.timeLimit,
    points: slide.points,
    scoreDependsOnTime: slide.scoreDependsOnTime,
    content: { url: mediaUrlOf(slide), alt: textField(contentOf(slide).alt) },
  }),
  acceptConfig: (slide) => ({
    region: pinRegion(slide),
    points: slide.points,
    scoreDependsOnTime: slide.scoreDependsOnTime,
    timeLimitMs: slide.timeLimit * 1000,
  }),
  answerSchema,
  accept: (cfg, { x, y }) => {
    if (x === undefined || y === undefined) rejectAnswer('Drop a pin on the image');
    if (x < 0 || x > 1 || y < 0 || y > 1) rejectAnswer('Pin coordinates must be between 0 and 1');
    const pin = { x: roundTo(x, COORD_DECIMALS), y: roundTo(y, COORD_DECIMALS) };
    const inside = cfg.region !== null && isInside(cfg.region, pin.x, pin.y);
    const ops: RedisOp[] = [
      lpushTrim('feed', `${pin.x},${pin.y}`, PIN_FEED_LENGTH),
      hincrby('dist', 'count'),
      hincrby('dist', `h:${heatCell(pin.x)}:${heatCell(pin.y)}`),
    ];
    if (inside) ops.push(hincrby('dist', 'inRegion'));
    return { isCorrect: inside, ops, persist: { optionIndex: null, text: null, payload: pin } };
  },
  score: (cfg, { isCorrect, elapsedMs }) =>
    speedScore(cfg.points, cfg.scoreDependsOnTime, cfg.timeLimitMs, isCorrect, elapsedMs),
  feedLength: PIN_FEED_LENGTH,
  distribution: (slide, { dist, feed }) => {
    const region = pinRegion(slide);
    const heat = Object.entries(dist)
      .filter(([field]) => field.startsWith('h:'))
      .map(([field, count]) => {
        const [, col, row] = field.split(':').map(Number);
        return { col: col!, row: row!, count: Number(count) };
      })
      .filter((cell) => Number.isInteger(cell.col) && Number.isInteger(cell.row) && cell.count > 0);
    return {
      kind: 'pin_on_image',
      count: Number(dist['count'] ?? 0),
      pins: feed.map(parsePin).filter((pin): pin is { x: number; y: number } => pin !== null),
      heat: { size: HEAT_GRID, cells: heat },
      region,
      inRegion: region ? Number(dist['inRegion'] ?? 0) : null,
    };
  },
  exportColumns: (slide) => [`${label(slide)} — x`, `${label(slide)} — y`],
  exportCells: (_slide, answer) => {
    const { x, y } = payloadOf(answer);
    return [typeof x === 'number' ? x : null, typeof y === 'number' ? y : null];
  },
  label,
});

registerSlideType(pinOnImageSlide);
