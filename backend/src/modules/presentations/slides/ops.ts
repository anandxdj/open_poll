import { ApiError } from '../../../common/utils/ApiError';
import type { RedisOp, SlideRedisTarget } from './types';

// ---------- Redis op builders (executed atomically by live/answer.service.ts) ----------

export const hincrby = (key: SlideRedisTarget, field: string, by = 1): RedisOp => ({
  op: 'hincrby',
  key,
  field,
  by,
});

export const hsetnx = (key: SlideRedisTarget, field: string, value: string): RedisOp => ({
  op: 'hsetnx',
  key,
  field,
  value,
});

/** Pushes to the head of a list and trims it to the newest `max` entries. */
export const lpushTrim = (key: SlideRedisTarget, value: string, max: number): RedisOp => ({
  op: 'lpush_trim',
  key,
  value,
  max,
});

// ---------- Shared grading helpers ----------

/** Case/whitespace-insensitive comparison key for typed answers and word counts. */
export const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** Rejects an answer; the answer service rolls back the dedup marker. */
export function rejectAnswer(message: string): never {
  throw ApiError.badRequest(message);
}

/**
 * Speed scoring: wrong = 0; correct = full points, or with `scoreDependsOnTime`
 * from 100% (instant) down to 50% (at the time limit).
 */
export const speedScore = (
  points: number,
  scoreDependsOnTime: boolean,
  timeLimitMs: number,
  isCorrect: boolean,
  elapsedMs: number
) => {
  if (!isCorrect) return 0;
  if (!scoreDependsOnTime) return points;
  const ratio = Math.min(Math.max(elapsedMs / timeLimitMs, 0), 1);
  return Math.round(points * (1 - ratio / 2));
};
