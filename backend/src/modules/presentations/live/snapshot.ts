import mongoose from 'mongoose';
import { redisClient } from '../../../common/config/redis';
import { PresentationAnswerModel } from '../models/answer.model';
import { PresentationParticipantModel } from '../models/participant.model';
import type { IPresentationSession, ISessionSlideStat } from '../models/session.model';
import type { LeaderboardEntry } from './contract';
import {
  FINAL_LEADERBOARD_SIZE,
  computeSlideDistributionHelper,
  getStoredLeaderboard,
  replayDistribution,
} from './distribution';
import { k } from './keys';
import { lifecycleOf, slideIdOf, type StoredAnswerResult } from './state';
import { visitedSlides } from './views';

/**
 * End-of-session reconciliation and snapshot. Answers reach Redis first and
 * Mongo by write-behind; when a session ends, Mongo is made complete from the
 * Redis results hashes, participant totals are recomputed from the answers,
 * and the aggregates are computed from that durable state.
 */

export interface SessionSnapshot {
  participantCount: number;
  answerCount: number;
  finalLeaderboard: LeaderboardEntry[];
  slideStats: ISessionSlideStat[];
}

const isDuplicateKeyOnly = (error: unknown) => {
  const e = error as { code?: number; writeErrors?: { code?: number }[] } | null;
  if (e?.writeErrors?.length) return e.writeErrors.every((w) => w.code === 11000);
  return e?.code === 11000;
};

const respondedSlides = (session: IPresentationSession) =>
  visitedSlides(session).filter(({ slide }) => lifecycleOf(slide.type) === 'response');

/**
 * Inserts the answers Redis accepted but Mongo never stored (failed or
 * still-pending write-behind). Returns how many were added.
 */
export const reconcileAnswers = async (session: IPresentationSession): Promise<number> => {
  const sid = String(session._id);
  let added = 0;
  for (const { slide } of respondedSlides(session)) {
    const slideId = slideIdOf(slide);
    const results = await redisClient.hGetAll(k.results(sid, slideId)).catch(() => ({}) as Record<string, string>);
    const participantIds = Object.keys(results);
    if (participantIds.length === 0) continue;

    const stored = await PresentationAnswerModel.find({ sessionId: sid, slideId }).select('participantId').lean();
    const have = new Set(stored.map((answer) => String(answer.participantId)));
    const missing = participantIds
      .filter((participantId) => !have.has(participantId))
      .flatMap((participantId) => {
        let result: StoredAnswerResult;
        try {
          result = JSON.parse(results[participantId]!) as StoredAnswerResult;
        } catch {
          return [];
        }
        if (typeof result.timeMs !== 'number' || typeof result.slideIndex !== 'number') return [];
        return [
          {
            presentationId: session.presentationId,
            sessionId: session._id,
            participantId,
            slideId,
            slideIndex: result.slideIndex,
            optionIndex: result.optionIndex ?? null,
            text: result.text ?? null,
            payload: result.payload ?? null,
            isCorrect: result.isCorrect,
            score: result.score,
            timeMs: result.timeMs,
            clientAnswerId: result.clientAnswerId ?? null,
            via: result.via ?? 'rest',
            createdAt: result.answeredAt ? new Date(result.answeredAt) : undefined,
          },
        ];
      });
    if (missing.length === 0) continue;

    try {
      await PresentationAnswerModel.insertMany(missing, { ordered: false });
      added += missing.length;
    } catch (error) {
      // A write-behind that landed meanwhile wins; anything else is reported.
      if (!isDuplicateKeyOnly(error)) console.error('[Presentation] Answer reconciliation failed:', error);
    }
  }
  return added;
};

/** Sets every participant's score and correct count from their stored answers. */
const reconcileParticipantTotals = async (session: IPresentationSession) => {
  const totals = await PresentationAnswerModel.aggregate<{ _id: unknown; score: number; correctCount: number }>([
    { $match: { sessionId: new mongoose.Types.ObjectId(String(session._id)) } },
    {
      $group: {
        _id: '$participantId',
        score: { $sum: '$score' },
        correctCount: { $sum: { $cond: ['$isCorrect', 1, 0] } },
      },
    },
  ]);
  if (totals.length === 0) return;
  await PresentationParticipantModel.bulkWrite(
    totals.map((total) => ({
      updateOne: {
        filter: { _id: total._id as mongoose.Types.ObjectId, sessionId: session._id },
        update: { $set: { score: total.score, correctCount: total.correctCount } },
      },
    }))
  );
};

const storedAnswerCounts = async (session: IPresentationSession): Promise<Map<string, number>> => {
  const rows = await PresentationAnswerModel.aggregate<{ _id: unknown; count: number }>([
    { $match: { sessionId: new mongoose.Types.ObjectId(String(session._id)) } },
    { $group: { _id: '$slideId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
};

/**
 * Results of every visited response slide. The Redis counters are used when
 * they cover exactly the stored answers; otherwise (Redis lost state) the
 * distribution is replayed from Mongo.
 */
const computeSlideStats = async (session: IPresentationSession, counts: Map<string, number>) => {
  const sid = String(session._id);
  const stats: ISessionSlideStat[] = [];
  for (const { slide, index } of respondedSlides(session)) {
    const slideId = slideIdOf(slide);
    const answeredCount = counts.get(slideId) ?? 0;
    const live = await computeSlideDistributionHelper(sid, slideId, slide);
    let distribution = live.distribution;
    if (live.answeredCount !== answeredCount) {
      const answers = await PresentationAnswerModel.find({ sessionId: sid, slideId })
        .sort({ createdAt: 1, _id: 1 })
        .select('optionIndex text payload timeMs')
        .lean();
      distribution = replayDistribution(slide, answers);
    }
    stats.push({ slideId: slide._id as mongoose.Types.ObjectId, slideIndex: index, type: slide.type, answeredCount, distribution });
  }
  return stats;
};

export const buildSessionSnapshot = async (session: IPresentationSession): Promise<SessionSnapshot> => {
  await reconcileAnswers(session);
  await reconcileParticipantTotals(session);
  const counts = await storedAnswerCounts(session);
  const sid = String(session._id);
  const [slideStats, finalLeaderboard, participantCount] = await Promise.all([
    computeSlideStats(session, counts),
    getStoredLeaderboard(sid, FINAL_LEADERBOARD_SIZE),
    PresentationParticipantModel.countDocuments({ sessionId: sid }),
  ]);
  return {
    participantCount,
    answerCount: [...counts.values()].reduce((sum, n) => sum + n, 0),
    finalLeaderboard,
    slideStats,
  };
};
