import { redisClient } from '../../../common/config/redis';
import { PresentationParticipantModel } from '../models/participant.model';
import { getSlideType } from '../slides';
import { k } from './keys';

export const LEADERBOARD_SIZE = 10;

/** Live participant count: Redis names hash, falling back to Mongo if Redis state was lost. */
export const getParticipantCount = (presentationId: string): Promise<number> =>
  redisClient
    .hLen(k.names(presentationId))
    .catch(() => 0)
    .then((n) => (n > 0 ? n : PresentationParticipantModel.countDocuments({ presentationId })));

/**
 * Live answer distribution for one slide, built from the hot-path Redis keys by
 * the slide type's `distribution`. Shared by reveal, host state, and the live
 * distribution worker. Types without one (leaderboard, content) yield `{}`.
 */
export const computeSlideDistributionHelper = async (
  presentationId: string,
  slideIndex: number,
  slide: any
): Promise<{ distribution: Record<string, unknown>; answeredCount: number; participantCount: number }> => {
  const def = getSlideType(slide?.type);
  const [dist, disp, answeredCount, nameCount, feed] = await Promise.all([
    redisClient.hGetAll(k.dist(presentationId, slideIndex)).catch(() => ({}) as Record<string, string>),
    redisClient.hGetAll(k.disp(presentationId, slideIndex)).catch(() => ({}) as Record<string, string>),
    redisClient.sCard(k.answered(presentationId, slideIndex)).catch(() => 0),
    redisClient.hLen(k.names(presentationId)).catch(() => 0),
    def?.feedLength
      ? redisClient.lRange(k.feed(presentationId, slideIndex), 0, def.feedLength - 1).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);

  const participantCount =
    nameCount > 0 ? nameCount : await PresentationParticipantModel.countDocuments({ presentationId });

  const distribution = def?.distribution ? def.distribution(slide, { dist, disp, feed }) : {};
  return { distribution, answeredCount, participantCount };
};

/**
 * Leaderboard from the Redis sorted set (fast, multi-instance safe).
 * Falls back to Mongo if Redis state was lost.
 */
export const getLeaderboard = async (presentationId: string, limit = LEADERBOARD_SIZE) => {
  try {
    const entries = await redisClient.zRangeWithScores(k.scores(presentationId), 0, limit - 1, {
      REV: true,
    });
    if (entries.length > 0) {
      const [names, correct] = await Promise.all([
        redisClient.hGetAll(k.names(presentationId)),
        redisClient.hGetAll(k.correct(presentationId)),
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

  const participants = await PresentationParticipantModel.find({ presentationId })
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
