import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { questionLabel } from '../../fields';
import { hincrby, rejectAnswer, speedScore } from '../../ops';
import type { Slide } from '../../types';
import {
  configOf,
  decimalsOf,
  finiteOr,
  gradableSlideSchema,
  isWorthPoints,
  payloadOf,
  requireTimerWhenGraded,
  roundTo,
  sum,
} from './shared';

/** Largest absolute min, max or correct value. */
export const GUESS_LIMIT = 1_000_000_000;
/** At most this many steps between min and max (the slider and the histogram stay usable). */
export const MAX_GUESS_STEPS = 1_000_000;
/** Decimal places allowed in min, max, step, correct value and tolerance. */
export const MAX_GUESS_DECIMALS = 4;
/** Wide ranges are grouped into at most this many histogram bars. */
export const GUESS_HISTOGRAM_BARS = 10;
/** Ranges with at most this many possible values get one bar per value. */
const MAX_VALUE_BARS = 20;

export interface GuessNumberSettings {
  min: number;
  max: number;
  step: number;
  /** The answer; null = no correct value (results only, never scored). */
  correct: number | null;
  /** A guess within ± tolerance of `correct` counts as correct. */
  tolerance: number;
}

const DEFAULTS: GuessNumberSettings = { min: 0, max: 100, step: 1, correct: null, tolerance: 0 };

const fewDecimals = (value: number) => decimalsOf(value) <= MAX_GUESS_DECIMALS;
const decimalsMessage = `Use at most ${MAX_GUESS_DECIMALS} decimal places`;
const bounded = z.number().min(-GUESS_LIMIT).max(GUESS_LIMIT).refine(fewDecimals, decimalsMessage);
const span = z
  .number()
  .max(2 * GUESS_LIMIT)
  .refine(fewDecimals, decimalsMessage);

/** Decimal places of the values on the slider (min + k·step). */
const gridDecimals = (s: Pick<GuessNumberSettings, 'min' | 'step'>) => Math.max(decimalsOf(s.min), decimalsOf(s.step));

/** Number of values the slider can take. */
const slotCount = (s: Pick<GuessNumberSettings, 'min' | 'max' | 'step'>) =>
  Math.floor((s.max - s.min) / s.step + 1e-9) + 1;

/** The slider step index of `value`, or null when it is off the steps. */
const stepIndexOf = (value: number, s: Pick<GuessNumberSettings, 'min' | 'step'>): number | null => {
  const k = Math.round((value - s.min) / s.step);
  return Math.abs(s.min + k * s.step - value) <= s.step * 1e-6 ? k : null;
};

const valueAt = (k: number, s: Pick<GuessNumberSettings, 'min' | 'step'>) =>
  roundTo(s.min + k * s.step, gridDecimals(s));

/** Float-safe "within tolerance". */
const isWithin = (value: number, correct: number, tolerance: number) =>
  Math.abs(value - correct) <= tolerance + 1e-9 * Math.max(1, Math.abs(tolerance), Math.abs(correct));

export const guessNumberSettingsSchema = z
  .object({
    min: bounded.default(DEFAULTS.min),
    max: bounded.default(DEFAULTS.max),
    step: span.positive('Step must be greater than 0').default(DEFAULTS.step),
    correct: bounded.nullable().default(null),
    tolerance: span.min(0, 'Tolerance cannot be negative').default(0),
  })
  .superRefine((s, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (s.max <= s.min) {
      issue('max', 'Max must be greater than min');
      return;
    }
    // A non-positive step is already reported by its own check.
    if (!(s.step > 0)) return;
    if (s.step > s.max - s.min) issue('step', 'Step must fit between min and max');
    else if ((s.max - s.min) / s.step > MAX_GUESS_STEPS) {
      issue('step', `Use a larger step: at most ${MAX_GUESS_STEPS.toLocaleString('en-US')} steps between min and max`);
    } else if (s.correct !== null) {
      if (s.correct < s.min || s.correct > s.max) issue('correct', 'The correct value must be between min and max');
      else if (stepIndexOf(s.correct, s) === null) issue('correct', 'The correct value must be on the slider steps');
    }
  });

/** Stored settings with defaults; malformed stored values fall back to the defaults. */
export const guessNumberSettings = (slide: Pick<Slide, 'config'>): GuessNumberSettings => {
  const c = configOf(slide);
  const min = finiteOr(c.min, DEFAULTS.min);
  const max = finiteOr(c.max, DEFAULTS.max);
  const step = finiteOr(c.step, DEFAULTS.step);
  if (!(max > min) || !(step > 0)) return { ...DEFAULTS };
  const correct = typeof c.correct === 'number' && Number.isFinite(c.correct) ? c.correct : null;
  return { min, max, step, correct, tolerance: Math.max(0, finiteOr(c.tolerance, 0)) };
};

/** Graded: worth points and has a correct value. Otherwise results only. */
const isGraded = (slide: Pick<Slide, 'points' | 'config'>) =>
  isWorthPoints(slide) && guessNumberSettings(slide).correct !== null;

interface GuessNumberConfig extends GuessNumberSettings {
  decimals: number;
  points: number;
  scoreDependsOnTime: boolean;
  timeLimitMs: number;
}

const answerSchema = z.object({ value: z.number().optional() });

const label = questionLabel('Guess the number');

export interface GuessBucket {
  /** First and last slider value in the bar (equal for one-value bars). */
  from: number;
  to: number;
  count: number;
}

/**
 * Histogram bars over the whole range: one per value for small ranges, else
 * at most `GUESS_HISTOGRAM_BARS` bars of equal width (in steps).
 */
const histogram = (s: GuessNumberSettings, values: { value: number; count: number }[]): GuessBucket[] => {
  const slots = slotCount(s);
  const perBar = slots <= MAX_VALUE_BARS ? 1 : Math.ceil(slots / GUESS_HISTOGRAM_BARS);
  const bars: GuessBucket[] = [];
  for (let first = 0; first < slots; first += perBar) {
    bars.push({ from: valueAt(first, s), to: valueAt(Math.min(first + perBar, slots) - 1, s), count: 0 });
  }
  for (const { value, count } of values) {
    const k = stepIndexOf(value, s) ?? Math.round((value - s.min) / s.step);
    const bar = bars[Math.min(bars.length - 1, Math.max(0, Math.floor(k / perBar)))];
    if (bar) bar.count += count;
  }
  return bars;
};

/** Median of a sorted value/count list (mean of the two middle guesses for an even count). */
const medianOf = (values: { value: number; count: number }[], total: number): number | null => {
  if (total === 0) return null;
  const at = (position: number) => {
    let seen = 0;
    for (const entry of values) {
      seen += entry.count;
      if (position < seen) return entry.value;
    }
    return values[values.length - 1]!.value;
  };
  return total % 2 === 1 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2;
};

/**
 * Guess a number on a slider (min…max in steps). With a correct value a guess
 * within ± tolerance is correct and, when the slide is worth points, scores
 * like select_answer (speed bonus optional). There is no partial credit for
 * near misses: `score` sees only correct/incorrect and the elapsed time.
 * Results: a histogram plus count, mean and median.
 */
export const guessNumberSlide = defineSlideType<GuessNumberConfig, z.infer<typeof answerSchema>>({
  type: 'guess_number',
  name: 'Guess the number',
  kind: 'interactive',
  lifecycle: 'response',
  scored: true,
  isScored: isGraded,
  schema: gradableSlideSchema('guess_number', guessNumberSettingsSchema.prefault({})).superRefine((slide, ctx) =>
    requireTimerWhenGraded(slide.points > 0 && slide.config.correct !== null, slide.timeLimit, ctx)
  ),
  // The correct value and tolerance never leave the server before the reveal.
  sanitize: (slide) => {
    const { min, max, step } = guessNumberSettings(slide);
    return {
      question: slide.question,
      timeLimit: slide.timeLimit,
      points: slide.points,
      scoreDependsOnTime: slide.scoreDependsOnTime,
      config: { min, max, step },
    };
  },
  acceptConfig: (slide) => {
    const settings = guessNumberSettings(slide);
    return {
      ...settings,
      decimals: gridDecimals(settings),
      points: slide.points,
      scoreDependsOnTime: slide.scoreDependsOnTime,
      timeLimitMs: slide.timeLimit * 1000,
    };
  },
  answerSchema,
  accept: (cfg, { value }) => {
    if (value === undefined) rejectAnswer('Enter your guess');
    if (value < cfg.min || value > cfg.max) rejectAnswer(`Your guess must be between ${cfg.min} and ${cfg.max}`);
    const k = stepIndexOf(value, cfg);
    if (k === null) rejectAnswer(`Your guess must be ${cfg.min} plus a multiple of ${cfg.step}`);
    const guess = roundTo(cfg.min + k * cfg.step, cfg.decimals);
    return {
      isCorrect: cfg.correct !== null && isWithin(guess, cfg.correct, cfg.tolerance),
      ops: [hincrby('dist', `v:${guess}`)],
      persist: { optionIndex: null, text: null, payload: { value: guess } },
    };
  },
  score: (cfg, { isCorrect, elapsedMs }) =>
    speedScore(cfg.points, cfg.scoreDependsOnTime, cfg.timeLimitMs, isCorrect, elapsedMs),
  distribution: (slide, { dist }) => {
    const s = guessNumberSettings(slide);
    const values = Object.entries(dist)
      .filter(([field]) => field.startsWith('v:'))
      .map(([field, count]) => ({ value: Number(field.slice(2)), count: Number(count) }))
      .filter((entry) => Number.isFinite(entry.value) && entry.count > 0)
      .sort((a, b) => a.value - b.value);
    const count = sum(values.map((entry) => entry.count));
    const decimals = Math.max(2, gridDecimals(s));
    const median = medianOf(values, count);
    return {
      kind: 'guess_number',
      min: s.min,
      max: s.max,
      step: s.step,
      count,
      mean: count > 0 ? roundTo(sum(values.map((e) => e.value * e.count)) / count, decimals) : null,
      median: median === null ? null : roundTo(median, decimals),
      buckets: histogram(s, values),
      correct: s.correct,
      tolerance: s.tolerance,
      correctCount:
        s.correct === null
          ? null
          : sum(values.filter((e) => isWithin(e.value, s.correct!, s.tolerance)).map((e) => e.count)),
    };
  },
  exportColumns: (slide) => [label(slide)],
  exportCells: (_slide, answer) => {
    const value = payloadOf(answer).value;
    return [typeof value === 'number' ? value : null];
  },
  label,
});

registerSlideType(guessNumberSlide);
