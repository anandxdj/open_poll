import { redisClient } from '../../../common/config/redis';
import { PresentationParticipantModel } from '../models/participant.model';
import { getSlideType, type DistributionRaw, type RedisOp } from '../slides';
import type { LeaderboardEntry } from './contract';
import { k } from './keys';

export const LEADERBOARD_SIZE = 10;
export const FINAL_LEADERBOARD_SIZE = 100;

/** Live participant count: Redis names hash, falling back to Mongo if Redis state was lost. */
export const getParticipantCount = (sessionId: string): Promise<number> =>
  redisClient
    .hLen(k.names(sessionId))
    .catch(() => 0)
    .then((n) => (n > 0 ? n : PresentationParticipantModel.countDocuments({ sessionId })));

/**
 * Live answer distribution for one slide of a session, built from the hot-path
 * Redis keys by the slide type's `distribution`. Shared by reveal, host state,
 * revisits and the live distribution worker. Types without one (leaderboard,
 * content) yield `{}`.
 */
export const computeSlideDistributionHelper = async (
  sessionId: string,
  slideId: string,
  slide: any
): Promise<{ distribution: Record<string, unknown>; answeredCount: number; participantCount: number }> => {
  const def = getSlideType(slide?.type);
  const [dist, disp, answeredCount, nameCount, feed] = await Promise.all([
    redisClient.hGetAll(k.dist(sessionId, slideId)).catch(() => ({}) as Record<string, string>),
    redisClient.hGetAll(k.disp(sessionId, slideId)).catch(() => ({}) as Record<string, string>),
    redisClient.sCard(k.answered(sessionId, slideId)).catch(() => 0),
    redisClient.hLen(k.names(sessionId)).catch(() => 0),
    def?.feedLength
      ? redisClient.lRange(k.feed(sessionId, slideId), 0, def.feedLength - 1).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);

  const participantCount =
    nameCount > 0 ? nameCount : await PresentationParticipantModel.countDocuments({ sessionId });

  const distribution = def?.distribution ? def.distribution(slide, { dist, disp, feed }) : {};
  return { distribution, answeredCount, participantCount };
};

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
 * re-running the type's `accept`: the durable fallback when the Redis counters
 * are gone or incomplete. Answers the type now rejects are skipped.
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

/**
 * Leaderboard from the session's Redis sorted set (fast, multi-instance safe).
 * Falls back to Mongo if Redis state was lost.
 */
export const getLeaderboard = async (sessionId: string, limit = LEADERBOARD_SIZE): Promise<LeaderboardEntry[]> => {
  try {
    const entries = await redisClient.zRangeWithScores(k.scores(sessionId), 0, limit - 1, {
      REV: true,
    });
    if (entries.length > 0) {
      const [names, correct] = await Promise.all([
        redisClient.hGetAll(k.names(sessionId)),
        redisClient.hGetAll(k.correct(sessionId)),
      ]);
      return entries.map((entry, i) => ({
        participantId: entry.value,
        name: names[entry.value] ?? 'Player',
        score: entry.score,
        correctCount: Number(correct[entry.value] ?? 0),
        rank: i + 1,
      }));
    }
  } catch (error) {
    console.error('[Presentation] Redis leaderboard failed, falling back to Mongo:', error);
  }
  return getStoredLeaderboard(sessionId, limit);
};

/** Leaderboard from the participant documents (durable totals). */
export const getStoredLeaderboard = async (sessionId: string, limit: number): Promise<LeaderboardEntry[]> => {
  const participants = await PresentationParticipantModel.find({ sessionId })
    .sort({ score: -1, joinedAt: 1 })
    .limit(limit)
    .lean();
  return participants.map((p, i) => ({
    participantId: String(p._id),
    name: p.name,
    score: p.score,
    correctCount: p.correctCount,
    rank: i + 1,
  }));
};
