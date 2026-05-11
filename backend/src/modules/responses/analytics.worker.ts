import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { REALTIME_CHANNELS, type ResponseAcceptedEvent } from '../../common/realtime/events';
import { AnalyticsModel } from './analytics.model';
import { ResponseService } from './responses.service';

const WORKER_INTERVAL_MS = 2000;

type BufferQuestionCount = {
  questionId: string;
  countsByIndex: Record<string, string>;
};

const getQuestionBufferKeys = async (pollId: string): Promise<string[]> => {
  const pattern = `buffer:poll:${pollId}:question:*`;
  const keys = await redisClient.keys(pattern);
  return keys;
};

const parseQuestionCount = async (key: string): Promise<BufferQuestionCount | null> => {
  const questionId = key.split('question:')[1];
  if (!questionId) return null;
  const countsByIndex = await redisClient.hGetAll(key);
  return { questionId, countsByIndex };
};

export const startAnalyticsWorker = () => {
  setInterval(async () => {
    try {
      const pollId = await redisClient.sPop('buffer:active_polls');
      if (!pollId) return;

      const totalDeltaString = await redisClient.get(`buffer:poll:${pollId}:total`);
      const totalDelta = totalDeltaString ? Number.parseInt(totalDeltaString, 10) : 0;
      const questionKeys = await getQuestionBufferKeys(pollId);

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
        for (const [index, value] of Object.entries(item.countsByIndex)) {
          const incrementBy = Number.parseInt(value, 10);
          if (!incrementBy) continue;
          bulkOperations.push({
            updateOne: {
              filter: { pollId: new mongoose.Types.ObjectId(pollId) },
              update: { $inc: { [`questionSummaries.$[question].counts.${index}`]: incrementBy } },
              arrayFilters: [{ 'question.questionId': new mongoose.Types.ObjectId(item.questionId) }],
            },
          });
        }
      }

      if (bulkOperations.length > 0) {
        await AnalyticsModel.bulkWrite(bulkOperations, { ordered: false });
      }

      updatePipeline.del(`buffer:poll:${pollId}:total`);
      for (const key of questionKeys) updatePipeline.del(key);
      updatePipeline.del(`poll:${pollId}:analytics_cache`);
      await updatePipeline.exec();

      const analytics = await ResponseService.getPollAnalytics(pollId);
      const event: ResponseAcceptedEvent = { pollId, analytics };
      await redisClient.publish(REALTIME_CHANNELS.analyticsUpdate, JSON.stringify(event));
    } catch (error: unknown) {
      console.error('[Analytics Worker Error]', error);
    }
  }, WORKER_INTERVAL_MS);
};
