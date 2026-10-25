import { countOf, distributionOfKind, finite, numberOr, record, roundTo } from "../../advanced/read";
import { DEFAULT_GUESS_CONFIG, gridDecimals, slotCount, type GuessNumberConfig } from "./config";

/** One histogram bar: the guesses from `from` to `to` (equal for one-value bars). */
export interface GuessBucket {
  from: number;
  to: number;
  count: number;
}

/** The results of a guess_number slide (`kind: "guess_number"`). */
export interface GuessDistribution {
  min: number;
  max: number;
  step: number;
  count: number;
  mean: number | null;
  median: number | null;
  buckets: GuessBucket[];
  /** Only in the host's and the revealed results; show it after the reveal. */
  correct: number | null;
  tolerance: number;
  correctCount: number | null;
}

/** Wide ranges are grouped into at most this many bars; small ranges get one bar per value. */
const BARS = 10;
const MAX_VALUE_BARS = 20;

/** The server's results, or null when `value` is not a guess_number distribution. */
export function parseGuessDistribution(value: unknown): GuessDistribution | null {
  const d = distributionOfKind(value, "guess_number");
  if (!d) return null;
  const buckets = (Array.isArray(d.buckets) ? d.buckets : []).flatMap((entry): GuessBucket[] => {
    const b = record(entry);
    const from = finite(b.from);
    const to = finite(b.to);
    return from !== null && to !== null ? [{ from, to, count: countOf(b.count) }] : [];
  });
  return {
    min: numberOr(d.min, DEFAULT_GUESS_CONFIG.min),
    max: numberOr(d.max, DEFAULT_GUESS_CONFIG.max),
    step: numberOr(d.step, DEFAULT_GUESS_CONFIG.step),
    count: countOf(d.count),
    mean: finite(d.mean),
    median: finite(d.median),
    buckets,
    correct: finite(d.correct),
    tolerance: Math.max(0, numberOr(d.tolerance, 0)),
    correctCount: finite(d.correctCount),
  };
}

/** The empty results of `config`: the bars the server will fill (thumbnails, before the first answer). */
export function emptyGuessDistribution(config: GuessNumberConfig): GuessDistribution {
  const slots = slotCount(config);
  const perBar = slots <= MAX_VALUE_BARS ? 1 : Math.ceil(slots / BARS);
  const decimals = gridDecimals(config);
  const at = (k: number) => roundTo(config.min + k * config.step, decimals);
  const buckets: GuessBucket[] = [];
  for (let first = 0; first < slots; first += perBar) {
    buckets.push({ from: at(first), to: at(Math.min(first + perBar, slots) - 1), count: 0 });
  }
  return {
    min: config.min,
    max: config.max,
    step: config.step,
    count: 0,
    mean: null,
    median: null,
    buckets,
    correct: config.correct,
    tolerance: config.tolerance,
    correctCount: null,
  };
}

/**
 * Whether a bar holds a correct guess: one of its values (`from`, `from + step`
 * … `to`) lies within correct ± tolerance. Single-value bars are just the
 * guess itself.
 */
export function isCorrectBucket(bucket: GuessBucket, correct: number | null, tolerance: number, step: number): boolean {
  if (correct === null) return false;
  const eps = 1e-9 * Math.max(1, Math.abs(correct), Math.abs(tolerance));
  const lo = Math.max(bucket.from, correct - tolerance);
  const hi = Math.min(bucket.to, correct + tolerance);
  if (lo > hi + eps) return false;
  const first = bucket.from + Math.ceil((lo - bucket.from) / step - 1e-9) * step;
  return first <= hi + eps && first <= bucket.to + eps;
}
