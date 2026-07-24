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

    // Standardize answers array
    const normalizedAnswers = payload.answers.map((answer) => {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        throw ApiError.badRequest(`Question ${answer.questionId} does not belong to this poll`);
      }

      let indices: number[] = [];
      if (Array.isArray(answer.selectedOptionIndices) && answer.selectedOptionIndices.length > 0) {
        indices = answer.selectedOptionIndices;
      } else if (typeof answer.selectedOptionIndex === 'number') {
        indices = [answer.selectedOptionIndex];
      }

      for (const idx of indices) {
        if (idx < 0 || idx >= question.options.length) {
          throw ApiError.badRequest(`Invalid option index ${idx} for question ${answer.questionId}`);
        }
      }

      return {
        questionId: answer.questionId,
        selectedOptionIndex: indices[0] ?? 0,
        selectedOptionIndices: indices,
      };
    });

    if (!poll.isAnonymous && !payload.respondentId) {
      throw ApiError.unauthorized('This poll requires you to be logged in to vote.');
    }

    const respondentKey = payload.respondentId || payload.deviceId;
    const spamKey = `poll:${payload.pollId}:voted:${payload.deviceId}`;

    // For standard polls, block duplicate votes. For trials, allow retries if the trial hasn't been passed.
    if (poll.pollType === 'POLL') {
      const hasVoted = await redisClient.get(spamKey);
      if (hasVoted) {
        throw ApiError.conflict('You have already voted on this poll.');
      }
      await redisClient.setEx(spamKey, 86400, 'true');
    }

    // Buffer counts to Redis for analytics pipeline
    const pipeline = redisClient.multi();
    pipeline.sAdd('buffer:active_polls', payload.pollId);
    pipeline.incr(`buffer:poll:${payload.pollId}:total`);
    for (const answer of normalizedAnswers) {
      for (const idx of answer.selectedOptionIndices) {
        pipeline.hIncrBy(
          `buffer:poll:${payload.pollId}:question:${answer.questionId}`,
          String(idx),
          1,
        );
      }
    }
    await pipeline.exec();

    let trialResult: any = null;
    let attemptNumber = 1;

    if (poll.pollType === 'TRIAL') {
      const previousAttempts = await ResponseModel.countDocuments({
        pollId: new mongoose.Types.ObjectId(payload.pollId),
        respondentId: respondentKey,
      });
      attemptNumber = previousAttempts + 1;

      let score = 0;
      let maxScore = 0;

      const breakdown = poll.questions.map((question) => {
        const userAns = normalizedAnswers.find((a) => a.questionId === String(question._id));
        const userIndices = (userAns?.selectedOptionIndices || []).slice().sort((a, b) => a - b);
        const correctIndices = (question.correctOptionIndices || []).slice().sort((a, b) => a - b);
        const qPoints = question.points || 1;
        maxScore += qPoints;

        const isCorrect =
          userIndices.length === correctIndices.length &&
          userIndices.every((val, idx) => val === correctIndices[idx]);

        if (isCorrect) {
          score += qPoints;
        }

        return {
          questionId: String(question._id),
          questionText: question.text,
          userSelectedIndices: userIndices,
          correctOptionIndices: correctIndices,
          isCorrect,
          explanation: question.explanation || '',
        };
      });

      const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
      const passThreshold = poll.passingScorePercentage ?? 70;
      const passed = percentage >= passThreshold;

      trialResult = {
        passed,
        score,
        maxScore,
        percentage,
        passingScorePercentage: passThreshold,
        attemptNumber,
        breakdown: breakdown.map((item) => {
          if (passed) {
            return item;
          } else {
            // Hide correct answers and explanations on failure to encourage learning
            return {
              questionId: item.questionId,
              questionText: item.questionText,
              userSelectedIndices: item.userSelectedIndices,
              isCorrect: item.isCorrect,
            };
          }
        }),
      };

      // Save Mongo response record asynchronously
      await ResponseModel.create({
        pollId: new mongoose.Types.ObjectId(payload.pollId),
        respondentId: respondentKey,
        answers: normalizedAnswers.map((a) => ({
          questionId: new mongoose.Types.ObjectId(a.questionId),
          selectedOptionIndex: a.selectedOptionIndex,
          selectedOptionIndices: a.selectedOptionIndices,
        })),
        attemptNumber,
        score,
        maxScore,
        percentage,
        passed,
      });

      return {
        message: passed
          ? 'Trial passed successfully! 🎉'
          : `Trial attempt #${attemptNumber} complete. Score: ${percentage}%. Pass threshold: ${passThreshold}%.`,
        trialResult,
      };
    }

    // For standard polls:
    ResponseModel.create({
      pollId: new mongoose.Types.ObjectId(payload.pollId),
      respondentId: respondentKey,
      answers: normalizedAnswers.map((a) => ({
        questionId: new mongoose.Types.ObjectId(a.questionId),
        selectedOptionIndex: a.selectedOptionIndex,
        selectedOptionIndices: a.selectedOptionIndices,
      })),
      attemptNumber: 1,
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
            selectedOptionText: question && typeof ans.selectedOptionIndex === 'number' && ans.selectedOptionIndex >= 0 && ans.selectedOptionIndex < question.options.length
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
