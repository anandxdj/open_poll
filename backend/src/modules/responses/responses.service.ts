import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import { PollModel } from '../polls/polls.model';
import { ResponseModel } from './responses.model';
import { REALTIME_CHANNELS } from '../../common/realtime/events';
import type { SubmitResponseInput } from './responses.schema';
import type { PollAnalyticsUpdateEvent, ResponseAcceptedEvent } from '../../common/realtime/events';

export class ResponseService {
  static async submitResponse(payload: SubmitResponseInput) {
    const poll = await PollModel.findById(payload.pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }

    if (!poll.isPublished) {
      throw ApiError.badRequest('Poll is not published');
    }

    if (poll.isClosed || poll.expiresAt.getTime() <= Date.now()) {
      throw ApiError.badRequest('Poll is closed or expired');
    }

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

    const response = await ResponseModel.create({
      pollId: new mongoose.Types.ObjectId(payload.pollId),
      respondentId: payload.respondentId,
      answers: payload.answers.map((a) => ({
        questionId: new mongoose.Types.ObjectId(a.questionId),
        selectedOptionIndex: a.selectedOptionIndex,
      })),
    });

    const analytics = await this.getPollAnalytics(payload.pollId);
    const event: ResponseAcceptedEvent = {
      pollId: payload.pollId,
      analytics,
    };

    await redisClient.publish(REALTIME_CHANNELS.responseAccepted, JSON.stringify(event));
    return response;
  }

  static async getPollAnalytics(pollId: string): Promise<PollAnalyticsUpdateEvent> {
    const poll = await PollModel.findById(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }

    const responses = await ResponseModel.find({ pollId });
    const summaryMap = new Map<string, number[]>();

    for (const question of poll.questions) {
      summaryMap.set(String(question._id), question.options.map(() => 0));
    }

    for (const response of responses) {
      for (const answer of response.answers) {
        const questionId = String(answer.questionId);
        const counts = summaryMap.get(questionId);
        if (!counts) continue;
        counts[answer.selectedOptionIndex] = (counts[answer.selectedOptionIndex] || 0) + 1;
      }
    }

    return {
      pollId,
      totalResponses: responses.length,
      questionSummaries: Array.from(summaryMap.entries()).map(([questionId, counts]) => ({
        questionId,
        counts,
      })),
      emittedAt: new Date().toISOString(),
    };
  }
}
