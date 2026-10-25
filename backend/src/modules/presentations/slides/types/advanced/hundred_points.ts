import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { questionLabel } from '../../fields';
import { hincrby, rejectAnswer } from '../../ops';
import type { RedisOp, Slide } from '../../types';
import { configOf, payloadOf, roundTo, sum, textItems, unscoredSlideSchema } from './shared';

/** Points every participant distributes. */
export const HUNDRED_POINTS_TOTAL = 100;
export const MIN_POINT_ITEMS = 2;
export const MAX_POINT_ITEMS = 10;

export const hundredPointsSettingsSchema = z.object({
  items: z
    .array(z.string().trim().min(1, 'Item text is required').max(200))
    .min(MIN_POINT_ITEMS, `Hundred points slides need at least ${MIN_POINT_ITEMS} items`)
    .max(MAX_POINT_ITEMS, `Hundred points slides take at most ${MAX_POINT_ITEMS} items`)
    .prefault([]),
});

export const hundredPointsItems = (slide: Pick<Slide, 'config'>): string[] => textItems(configOf(slide).items);

interface HundredPointsConfig {
  itemCount: number;
}

const answerSchema = z.object({ points: z.array(z.number()).max(MAX_POINT_ITEMS).optional() });

const label = questionLabel('100 points');

/**
 * Each participant shares exactly 100 points between 2–10 items (whole
 * numbers, none negative); never scored. Results: total and average points
 * per item, in the authored order.
 */
export const hundredPointsSlide = defineSlideType<HundredPointsConfig, z.infer<typeof answerSchema>>({
  type: 'hundred_points',
  name: '100 points',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: unscoredSlideSchema('hundred_points', hundredPointsSettingsSchema.prefault({})),
  sanitize: (slide) => ({
    question: slide.question,
    timeLimit: slide.timeLimit,
    config: { items: hundredPointsItems(slide) },
  }),
  acceptConfig: (slide) => ({ itemCount: hundredPointsItems(slide).length }),
  answerSchema,
  accept: (cfg, { points }) => {
    if (!points || points.length !== cfg.itemCount) rejectAnswer(`Give points to each of the ${cfg.itemCount} items`);
    if (points.some((p) => !Number.isInteger(p))) rejectAnswer('Points must be whole numbers');
    if (points.some((p) => p < 0)) rejectAnswer('Points cannot be negative');
    const total = sum(points);
    if (total !== HUNDRED_POINTS_TOTAL) {
      rejectAnswer(`Points must add up to ${HUNDRED_POINTS_TOTAL} (you gave ${total})`);
    }
    const ops: RedisOp[] = points.flatMap((p, i) => (p > 0 ? [hincrby('dist', `i:${i}`, p)] : []));
    ops.push(hincrby('dist', 'voters'));
    return { isCorrect: false, ops, persist: { optionIndex: null, text: null, payload: { points } } };
  },
  distribution: (slide, { dist }) => {
    const voters = Number(dist['voters'] ?? 0);
    return {
      kind: 'hundred_points',
      items: hundredPointsItems(slide).map((text, i) => {
        const total = Number(dist[`i:${i}`] ?? 0);
        return { text, total, average: voters > 0 ? roundTo(total / voters, 1) : 0 };
      }),
      voters,
    };
  },
  exportColumns: (slide) => hundredPointsItems(slide).map((item) => `${label(slide)} — ${item}`),
  exportCells: (slide, answer) => {
    const points = payloadOf(answer).points;
    return hundredPointsItems(slide).map((_, i) =>
      Array.isArray(points) && typeof points[i] === 'number' ? (points[i] as number) : null
    );
  },
  label,
});

registerSlideType(hundredPointsSlide);
