import { PollModel } from './polls.model';
import type { CreatePollInput, UpdatePollInput } from './polls.schema';
import { ApiError } from '../../common/utils/ApiError';
import { AnalyticsModel } from '../responses/analytics.model';

export class PollService {
  static async createPoll(payload: CreatePollInput, creatorId: string) {
    const newPoll = await PollModel.create({
      ...payload,
      expiresAt: new Date(payload.expiresAt),
      creatorId,
    });

    await AnalyticsModel.create({
      pollId: newPoll._id,
      totalResponses: 0,
      questionSummaries: newPoll.questions.map((question) => ({
        questionId: question._id,
        counts: question.options.map(() => 0),
      })),
    });

    return newPoll;
  }

  static async getPollById(pollId: string) {
    const poll = await PollModel.findById(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }
    return poll;
  }

  static async listPollsByCreator(creatorId: string) {
    return PollModel.find({ creatorId }).sort({ createdAt: -1 });
  }

  static async updatePoll(pollId: string, payload: UpdatePollInput) {
    const poll = await this.getPollById(pollId);

    if (poll.isClosed) {
      throw ApiError.badRequest('Closed polls cannot be updated');
    }

    if (payload.title !== undefined) poll.title = payload.title;
    if (payload.isAnonymous !== undefined) poll.isAnonymous = payload.isAnonymous;
    if (payload.expiresAt !== undefined) poll.expiresAt = new Date(payload.expiresAt);
    if (payload.isPublished !== undefined) poll.isPublished = payload.isPublished;
    if (payload.questions !== undefined) poll.questions = payload.questions;

    await poll.save();
    return poll;
  }

  static async closePoll(pollId: string) {
    const poll = await this.getPollById(pollId);

    if (poll.isClosed) {
      return poll;
    }

    poll.isClosed = true;
    poll.expiresAt = new Date();
    poll.closedAt = new Date();
    await poll.save();
    return poll;
  }
}