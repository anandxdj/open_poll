import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import type { ResponseAcceptedEvent } from '../../common/realtime/events';
import { publishPollAnalytics } from '../../common/realtime/publish';
import { AnalyticsModel } from './analytics.model';
import { ResponseService } from './responses.service';

const WORKER_INTERVAL_MS = 2000;

type BufferQuestionCount = {
  questionId: string;
  countsByIndex: Record<string, string>;
};

/** The poll's question ids with buffered counters: a per-poll SET, so no `KEYS` scan blocks Redis. */
const questionsSetKey = (pollId: string) => `buffer:poll:${pollId}:questions`;

const getQuestionBufferKeys = async (pollId: string): Promise<{ keys: string[]; questionIds: string[] }> => {
  const questionIds = await redisClient.sMembers(questionsSetKey(pollId));
  return { keys: questionIds.map((questionId) => `buffer:poll:${pollId}:question:${questionId}`), questionIds };
};

const parseQuestionCount = async (key: string): Promise<BufferQuestionCount | null> => {
  const questionId = key.split('question:')[1];
  if (!questionId) return null;
  const countsByIndex = await redisClient.hGetAll(key);
  return { questionId, countsByIndex };
};

/**
 * Flushes one poll's buffered counters into its analytics document and tells every instance.
 * Returns the poll id it flushed, or null when nothing was buffered.
 */
export const runAnalyticsTick = async (): Promise<string | null> => {
  const pollId = await redisClient.sPop('buffer:active_polls');
  if (!pollId) return null;

  const totalDeltaString = await redisClient.get(`buffer:poll:${pollId}:total`);
  const totalDelta = totalDeltaString ? Number.parseInt(totalDeltaString, 10) : 0;
  const { keys: questionKeys, questionIds } = await getQuestionBufferKeys(pollId);

  const parsedQuestionCounts = (
    await Promise.all(questionKeys.map((key) => parseQuestionCount(key)))
  ).filter((item): item is BufferQuestionCount => item !== null);

  const updatePipeline = redisClient.multi();
  const bulkOperations: Array<{
    updateOne: {
      filter: { pollId: mongoose.Types.ObjectId };
      update: { $inc: Record<string, number> };
      arrayFilters?: Array<Record<string, mongoose.Types.ObjectId>>;
    };
  }> = [];

  if (totalDelta > 0) {
    bulkOperations.push({
      updateOne: {
        filter: { pollId: new mongoose.Types.ObjectId(pollId) },
        update: { $inc: { totalResponses: totalDelta } },
      },
    });
  }

  for (const item of parsedQuestionCounts) {
    if (!item.questionId || item.questionId === 'undefined') {
      console.warn(`[Analytics Worker] Skipping invalid questionId: ${item.questionId} for poll: ${pollId}`);
      continue;
    }

    for (const [index, value] of Object.entries(item.countsByIndex)) {
      const incrementBy = Number.parseInt(value, 10);
      if (!incrementBy) continue;
      
      try {
        bulkOperations.push({
          updateOne: {
            filter: { pollId: new mongoose.Types.ObjectId(pollId) },
            update: { $inc: { [`questionSummaries.$[question].counts.${index}`]: incrementBy } },
            arrayFilters: [{ 'question.questionId': new mongoose.Types.ObjectId(item.questionId) }],
          },
        });
      } catch (e) {
        console.error(`[Analytics Worker] Failed to build operation for question: ${item.questionId}`, e);
      }
    }
  }

  if (bulkOperations.length > 0) {
    await AnalyticsModel.bulkWrite(bulkOperations, { ordered: false });
  }

  updatePipeline.del(`buffer:poll:${pollId}:total`);
  for (const key of questionKeys) updatePipeline.del(key);
  // Only the questions flushed above leave the set: a vote buffered meanwhile keeps its entry.
  if (questionIds.length > 0) updatePipeline.sRem(questionsSetKey(pollId), questionIds);
  updatePipeline.del(`poll:${pollId}:analytics_cache`);
  await updatePipeline.exec();

  const analytics = await ResponseService.getPollAnalytics(pollId);
  const event: ResponseAcceptedEvent = { pollId, analytics };
  await publishPollAnalytics(event);
  return pollId;
};

export const startAnalyticsWorker = () => {
  setInterval(async () => {
    try {
      await runAnalyticsTick();
    } catch (error: unknown) {
      console.error('[Analytics Worker Error]', error);
    }
  }, WORKER_INTERVAL_MS);
};
