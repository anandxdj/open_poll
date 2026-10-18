import { redisClient } from '../../../common/config/redis';
import { PresentationParticipantModel } from '../models/participant.model';
import { getSlideType } from '../slides';
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
