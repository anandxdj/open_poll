import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import { PollModel } from '../polls/polls.model';
import { ResponseModel } from './responses.model';
import type { SubmitResponseInput } from './responses.schema';
import { AnalyticsModel } from './analytics.model';
import type { PollAnalyticsUpdateEvent } from '../../common/realtime/events';
import { UserModel } from '../auth/auth.model';

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

    if (!poll.isAnonymous && !payload.respondentId) {
      throw ApiError.unauthorized('This poll requires you to be logged in to vote.');
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

    let analyticsDoc = await AnalyticsModel.findOne({
      pollId: new mongoose.Types.ObjectId(pollId),
    });

    if (!analyticsDoc) {
      // Recovery logic: if poll exists but analytics is missing, create it
      const poll = await PollModel.findById(pollId);
      if (!poll) throw ApiError.notFound('Poll not found');

      analyticsDoc = await AnalyticsModel.create({
        pollId: poll._id,
        totalResponses: 0,
        questionSummaries: poll.questions.map((q) => ({
          questionId: q._id,
          counts: q.options.map(() => 0),
        })),
      });
    }

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

  static async getPollResponsesList(pollId: string, userId: string) {
    const poll = await PollModel.findById(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }

    if (String(poll.creatorId) !== String(userId)) {
      throw ApiError.forbidden('You are not authorized to view individual responses for this poll');
    }

    const responses = await ResponseModel.find({
      pollId: new mongoose.Types.ObjectId(pollId),
    }).sort({ createdAt: -1 });

    const registeredUserIds = responses
      .map((r) => r.respondentId)
      .filter((id) => id && !id.startsWith('guest:') && mongoose.Types.ObjectId.isValid(id));

    const users = await UserModel.find({
      _id: { $in: registeredUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select('name email');

    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const list = responses.map((r) => {
      let voter = {
        type: 'anonymous',
        name: 'Anonymous Voter',
        email: '',
      };

      if (!poll.isAnonymous && r.respondentId) {
        if (r.respondentId.startsWith('guest:')) {
          const parts = r.respondentId.split(':');
          const email = parts[1] || '';
          const name = parts[2] || 'Guest Voter';
          voter = {
            type: 'guest',
            name,
            email,
          };
        } else {
          const userDoc = userMap.get(r.respondentId);
          if (userDoc) {
            voter = {
              type: 'registered',
              name: userDoc.name,
              email: userDoc.email,
            };
          } else {
            voter = {
              type: 'registered',
              name: 'Registered Voter',
              email: r.respondentId,
            };
          }
        }
      }

      return {
        _id: r._id,
        voter,
        answers: r.answers.map((ans) => {
          const question = poll.questions.find((q) => String(q._id) === String(ans.questionId));
          return {
            questionId: String(ans.questionId),
            questionText: question ? question.text : 'Unknown Question',
            selectedOptionIndex: ans.selectedOptionIndex,
            selectedOptionText: question && ans.selectedOptionIndex >= 0 && ans.selectedOptionIndex < question.options.length
              ? question.options[ans.selectedOptionIndex]
              : 'Skipped/Invalid',
          };
        }),
        createdAt: r.createdAt,
      };
    });

    return list;
  }
}
