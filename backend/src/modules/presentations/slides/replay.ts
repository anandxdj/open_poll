import { getSlideType } from './registry';
import type { DistributionRaw, RedisOp } from './types';

/** The stored answer columns a distribution can be replayed from. */
export interface ReplayableAnswer {
  optionIndex?: number | null;
  text?: string | null;
  payload?: unknown;
  timeMs?: number;
}

const applyOp = (raw: DistributionRaw, op: RedisOp) => {
  const target = raw[op.key];
  switch (op.op) {
    case 'hincrby': {
      const hash = target as Record<string, string>;
      hash[op.field] = String(Number(hash[op.field] ?? 0) + op.by);
      break;
    }
    case 'hsetnx': {
      const hash = target as Record<string, string>;
      if (!(op.field in hash)) hash[op.field] = op.value;
      break;
    }
    case 'lpush_trim': {
      const list = target as string[];
      list.unshift(op.value);
      list.length = Math.min(list.length, op.max);
      break;
    }
  }
};

/**
 * Rebuilds a slide's distribution from stored answers (oldest first) by
 * re-running the type's `accept` into in-memory counters: the durable fallback
 * when the Redis counters are gone or incomplete, and the source for sessions
 * that predate them. Answers the type now rejects are skipped.
 */
export const replayDistribution = (slide: any, answers: ReplayableAnswer[]): Record<string, unknown> => {
  const def = getSlideType(slide?.type);
  if (!def?.accept || !def.distribution) return {};
  const cfg = def.acceptConfig ? def.acceptConfig(slide) : null;
  const raw: DistributionRaw = { dist: {}, disp: {}, feed: [] };
  for (const answer of answers) {
    const stored = answer.payload && typeof answer.payload === 'object' ? (answer.payload as Record<string, unknown>) : {};
    const payload: Record<string, unknown> = { ...stored };
    if (answer.optionIndex != null) payload.optionIndex = answer.optionIndex;
    if (answer.text != null) payload.text = answer.text;
    try {
      const parsed = def.answerSchema ? def.answerSchema.parse(payload) : payload;
      def.accept(cfg, parsed, { elapsedMs: answer.timeMs ?? 0 }).ops.forEach((op) => applyOp(raw, op));
    } catch {
      continue;
    }
  }
  return def.distribution(slide, raw);
};
