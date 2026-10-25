import { clamp, configOf, decimalsOf, finite, numberOr, roundTo } from "../../advanced/read";

// guess_number settings (`slide.config`) and the rules the backend enforces
// (backend/src/modules/presentations/slides/types/advanced/guess_number.ts).
// Shared by the editor, the participant slider and the stage, so it stays
// free of editor code.

/** Largest absolute min, max or correct value. */
export const GUESS_LIMIT = 1_000_000_000;
/** At most this many steps between min and max. */
export const MAX_GUESS_STEPS = 1_000_000;
/** Decimal places allowed in min, max, step, correct value and tolerance. */
export const MAX_GUESS_DECIMALS = 4;

export type GuessNumberConfig = {
  min: number;
  max: number;
  step: number;
  /** The answer; null = no correct value (results only). */
  correct: number | null;
  /** A guess within ± tolerance of `correct` counts as correct. */
  tolerance: number;
};

export const DEFAULT_GUESS_CONFIG: GuessNumberConfig = { min: 0, max: 100, step: 1, correct: null, tolerance: 0 };

/** The stored fields as they are, each falling back on its own: for the editor, which edits one field at a time. */
export function rawGuessConfig(slide: object): GuessNumberConfig {
  const c = configOf(slide);
  return {
    min: numberOr(c.min, DEFAULT_GUESS_CONFIG.min),
    max: numberOr(c.max, DEFAULT_GUESS_CONFIG.max),
    step: numberOr(c.step, DEFAULT_GUESS_CONFIG.step),
    correct: finite(c.correct),
    tolerance: Math.max(0, numberOr(c.tolerance, 0)),
  };
}

/** Settings for the views: an unusable range or step falls back to the defaults, like the backend. */
export function guessNumberConfig(slide: object): GuessNumberConfig {
  const raw = rawGuessConfig(slide);
  return raw.max > raw.min && raw.step > 0 ? raw : { ...DEFAULT_GUESS_CONFIG };
}

/** Decimal places of the values on the slider (min + k·step). */
export const gridDecimals = (c: Pick<GuessNumberConfig, "min" | "step">) =>
  Math.max(decimalsOf(c.min), decimalsOf(c.step));

/** Number of values the slider can take. */
export const slotCount = (c: Pick<GuessNumberConfig, "min" | "max" | "step">) =>
  Math.floor((c.max - c.min) / c.step + 1e-9) + 1;

/** The slider step index of `value`, or null when it is off the steps. */
export const stepIndexOf = (value: number, c: Pick<GuessNumberConfig, "min" | "step">): number | null => {
  const k = Math.round((value - c.min) / c.step);
  return Math.abs(c.min + k * c.step - value) <= c.step * 1e-6 ? k : null;
};

/** The nearest allowed guess to `value`: inside min…max and on the steps. */
export function snapGuess(value: number, c: Pick<GuessNumberConfig, "min" | "max" | "step">): number {
  const k = clamp(Math.round((value - c.min) / c.step), 0, slotCount(c) - 1);
  return roundTo(c.min + k * c.step, gridDecimals(c));
}

/** Float-safe "within tolerance". */
export const isWithin = (value: number, correct: number, tolerance: number) =>
  Math.abs(value - correct) <= tolerance + 1e-9 * Math.max(1, Math.abs(tolerance), Math.abs(correct));

/** First problem with the settings (a save-time message, lowercase, unprefixed), or null. */
export function guessConfigIssue(c: GuessNumberConfig, graded: boolean): string | null {
  const values = [c.min, c.max, c.step, c.tolerance, ...(graded && c.correct !== null ? [c.correct] : [])];
  if (values.some((v) => decimalsOf(v) > MAX_GUESS_DECIMALS)) {
    return `use at most ${MAX_GUESS_DECIMALS} decimal places.`;
  }
  if (Math.abs(c.min) > GUESS_LIMIT || Math.abs(c.max) > GUESS_LIMIT) {
    return "min and max must be within ±1,000,000,000.";
  }
  if (c.max <= c.min) return "max must be greater than min.";
  if (c.step <= 0) return "step must be greater than 0.";
  if (c.step > c.max - c.min) return "step must fit between min and max.";
  if ((c.max - c.min) / c.step > MAX_GUESS_STEPS) {
    return "use a larger step: at most 1,000,000 steps between min and max.";
  }
  if (c.tolerance < 0) return "tolerance cannot be negative.";
  if (c.tolerance > 2 * GUESS_LIMIT) return "tolerance is too large.";
  if (graded) {
    if (c.correct === null) return "enter the correct number, or turn grading off.";
    if (c.correct < c.min || c.correct > c.max) return "the correct number must be between min and max.";
    if (stepIndexOf(c.correct, c) === null) return "the correct number must be on the slider steps.";
  }
  return null;
}

/** A guess slide worth points is graded and needs a correct number; one worth 0 shows results only. */
export const isGradedGuess = (slide: { points: number }) => slide.points > 0;
