import { z } from 'zod';
import { commonSlideShape, untimedOrTimerSchema } from '../../fields';
import type { Slide } from '../../types';

/**
 * Shared pieces of the advanced interactive types (`guess_number`,
 * `hundred_points`, `grid_2x2`, `pin_on_image`): `kind: 'interactive'`,
 * `lifecycle: 'response'`. Their settings live in `slide.config` (Mixed),
 * validated by the type's request schema and read back defensively; answer
 * keys (correct value, correct region) stay in `config` and never reach
 * participants, because every `sanitize` copies an explicit allow-list.
 * All counting is expressed as registry `RedisOp`s, never direct Redis calls.
 */

/** Scored slides need a deadline for speed scoring, like the built-in scored types. */
export const MIN_SCORED_TIMER_SECONDS = 5;

/** The fields every advanced type shares: common fields, a required question, a timer (0 = untimed, else 5–300 s). */
const advancedBase = <T extends string>(type: T) => ({
  type: z.literal(type),
  ...commonSlideShape,
  question: z.string().trim().min(1, 'Question text is required').max(500),
  timeLimit: untimedOrTimerSchema,
});

/**
 * Request schema of a type that can be graded: `points` (0 = ungraded) and
 * `scoreDependsOnTime` as on the built-in scored types, plus its `config`.
 * Check the timer of graded slides with `requireTimerWhenGraded`.
 */
export const gradableSlideSchema = <T extends string, C extends z.ZodType>(type: T, config: C) =>
  z.object({
    ...advancedBase(type),
    points: z.number().int().min(0).max(10000).default(1000),
    scoreDependsOnTime: z.boolean().default(true),
    config,
  });

/** Request schema of an unscored type: no points are stored, whatever the client sends. */
export const unscoredSlideSchema = <T extends string, C extends z.ZodType>(type: T, config: C) =>
  z.object({
    ...advancedBase(type),
    points: z.unknown().optional().transform(() => 0),
    scoreDependsOnTime: z.unknown().optional().transform(() => false),
    config,
  });

/**
 * Adds the "graded slides need a timer" issue (speed scoring needs a
 * deadline). Only an untimed (0) slide can get here: 1–4 s is already
 * rejected by the timer schema.
 */
export const requireTimerWhenGraded = (graded: boolean, timeLimit: number, ctx: z.RefinementCtx) => {
  if (graded && timeLimit === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['timeLimit'],
      message: `Scored slides need a timer of at least ${MIN_SCORED_TIMER_SECONDS} seconds`,
    });
  }
};

/** A slide worth points (`points` absent counts as the default 1000). */
export const isWorthPoints = (slide: Pick<Slide, 'points'>) => slide.points == null || slide.points > 0;

// ---------- Reading stored settings ----------

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/**
 * The stored `config` as a plain record. It was validated on save, but it is
 * a Mixed field (and decks are snapshotted), so every read stays defensive.
 */
export const configOf = (slide: Pick<Slide, 'config'>): Record<string, unknown> => record(slide.config);

export const recordOf = record;

export const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const textOr = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export const textItems = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** The payload object of a stored answer (exports). */
export const payloadOf = (answer: { payload?: unknown } | null | undefined): Record<string, unknown> =>
  record(answer?.payload);

// ---------- Numbers ----------

/** Decimal places of a finite number as written (`0.25` → 2, `1e-7` → 7). */
export const decimalsOf = (value: number): number => {
  const [mantissa = '', exponent] = String(value).toLowerCase().split('e');
  const fraction = mantissa.split('.')[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent ?? 0));
};

/** `value` rounded to `decimals` places, without float noise. */
export const roundTo = (value: number, decimals: number): number => Number(value.toFixed(Math.min(decimals, 20)));

/** Sum of a list of numbers. */
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
