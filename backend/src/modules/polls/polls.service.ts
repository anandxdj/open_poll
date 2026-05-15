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
    if (payload.questions !== undefined) {
      poll.questions = payload.questions as any;
      
      // Sync AnalyticsModel to match new questions while preserving existing counts
      const analytics = await AnalyticsModel.findOne({ pollId: poll._id });
      if (analytics) {
        const existingMap = new Map(
          analytics.questionSummaries.map((s) => [String(s.questionId), s.counts])
        );

        analytics.questionSummaries = poll.questions.map((q) => {
          const existingCounts = existingMap.get(String(q._id));
          // If question existed and options count matches, keep counts. 
          // Otherwise (new question or options changed), reset to zeros.
          const counts = (existingCounts && existingCounts.length === q.options.length)
            ? existingCounts
            : q.options.map(() => 0);

          return {
            questionId: q._id,
            counts
          } as any;
        });

        await analytics.save();
      }
    }

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

  static async deletePoll(pollId: string) {
    const poll = await PollModel.findByIdAndDelete(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }
    // Delete associated analytics
    await AnalyticsModel.findOneAndDelete({ pollId });
    return poll;
  }

  static async publishResults(pollId: string) {
    const poll = await this.getPollById(pollId);

    // Results can only be published if the poll is closed or expired
    const isExpired = poll.expiresAt.getTime() <= Date.now();
    if (!poll.isClosed && !isExpired) {
      throw ApiError.badRequest('Results can only be published after the poll is closed or expired');
    }

    poll.isResultsPublished = true;
    poll.resultsPublishedAt = new Date();
    await poll.save();
    return poll;
  }
}