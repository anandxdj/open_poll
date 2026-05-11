import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import { PollModel } from '../polls/polls.model';
import { ResponseModel } from './responses.model';
import type { SubmitResponseInput } from './responses.schema';
import { AnalyticsModel } from './analytics.model';
import type { PollAnalyticsUpdateEvent } from '../../common/realtime/events';

export class ResponseService {
  static async submitResponse(payload: SubmitResponseInput) {
    const poll = await PollModel.findById(payload.pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }

    if (!poll.isPublished) {
      throw ApiError.badRequest('Poll is not published');
    }

    if (poll.isClosed) throw ApiError.badRequest('Poll is closed');
    if (poll.expiresAt.getTime() <= Date.now()) throw ApiError.badRequest('Poll is expired');

    const questionMap = new Map(
      poll.questions.map((question) => [String(question._id), question]),
    );

    const providedQuestionIds = new Set(payload.answers.map((a) => a.questionId));

    for (const question of poll.questions) {
      if (question.isMandatory && !providedQuestionIds.has(String(question._id))) {
        throw ApiError.badRequest(`Mandatory question '${question.text}' is missing`);
      }
    }

    for (const answer of payload.answers) {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        throw ApiError.badRequest(`Question ${answer.questionId} does not belong to this poll`);
      }

      if (answer.selectedOptionIndex < 0 || answer.selectedOptionIndex >= question.options.length) {
        throw ApiError.badRequest(`Invalid selectedOptionIndex for question ${answer.questionId}`);
      }
    }

    const spamKey = `poll:${payload.pollId}:voted:${payload.deviceId}`;
    const hasVoted = await redisClient.get(spamKey);
    if (hasVoted) {
      throw ApiError.conflict('You have already voted on this poll.');
    }
    await redisClient.setEx(spamKey, 86400, 'true');

    const pipeline = redisClient.multi();
    pipeline.sAdd('buffer:active_polls', payload.pollId);
    pipeline.incr(`buffer:poll:${payload.pollId}:total`);
    for (const answer of payload.answers) {
      pipeline.hIncrBy(
        `buffer:poll:${payload.pollId}:question:${answer.questionId}`,
        String(answer.selectedOptionIndex),
        1,
      );
    }
    await pipeline.exec();

    ResponseModel.create({
      pollId: new mongoose.Types.ObjectId(payload.pollId),
      respondentId: payload.respondentId ?? 'mock-respondent-123',
      answers: payload.answers.map((a) => ({
        questionId: new mongoose.Types.ObjectId(a.questionId),
        selectedOptionIndex: a.selectedOptionIndex,
      })),
    }).catch((error: unknown) => {
      console.error('[Mongo Backup Error]', error);
    });

    return { message: 'Response recorded successfully' };
  }

  static async getPollAnalytics(pollId: string): Promise<PollAnalyticsUpdateEvent> {
    const cacheKey = `poll:${pollId}:analytics_cache`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PollAnalyticsUpdateEvent;
    }

    const analyticsDoc = await AnalyticsModel.findOne({
      pollId: new mongoose.Types.ObjectId(pollId),
    });
    if (!analyticsDoc) throw ApiError.notFound('Analytics not found for poll');

    const analytics: PollAnalyticsUpdateEvent = {
      pollId,
      totalResponses: analyticsDoc.totalResponses,
      questionSummaries: analyticsDoc.questionSummaries.map((summary) => ({
        questionId: String(summary.questionId),
        counts: summary.counts,
      })),
      emittedAt: new Date().toISOString(),
    };

    await redisClient.set(cacheKey, JSON.stringify(analytics), { EX: 3600 });
    return analytics;
  }
}
