import type { Types } from 'mongoose';
import { PollModel, type IPoll } from './polls.model';
import type { CreatePollInput, UpdatePollInput } from './polls.schema';
import { ApiError } from '../../common/utils/ApiError';
import { copyTitle } from '../../common/utils/copyTitle';
import { assertCan } from '../../common/tenancy/policy';
import { resolveWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { AnalyticsModel } from '../responses/analytics.model';
import { assertQuestionsGradeable } from './polls.grading';

type IdLike = Types.ObjectId | string;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Expiry of a duplicate whose source closes within a day: the poll builder's default for a new poll. */
const DUPLICATE_EXPIRY_DAYS = 7;

/**
 * Expiry of a poll's duplicate: the source's while it is at least a day away
 * (still a usable window), otherwise a week from `now`. Always in the future.
 */
export function duplicateExpiresAt(sourceExpiresAt: Date | null | undefined, now: Date): Date {
  if (sourceExpiresAt && sourceExpiresAt.getTime() - now.getTime() >= DAY_MS) return new Date(sourceExpiresAt);
  return new Date(now.getTime() + DUPLICATE_EXPIRY_DAYS * DAY_MS);
}

/** The workspace a poll list is read from, and who is reading it. */
export interface PollListScope {
  userId: string;
  workspace: { _id: IdLike; type: string; ownerId: IdLike };
}

export class PollService {
  /**
   * Creates a poll in `workspaceId` (REST passes `req.workspace`, already
   * authorized). Callers without a request workspace (MCP, AI generate-and-save)
   * omit it: the poll lands in the creator's default workspace, provided their
   * role there may create content.
   */
  static async createPoll(payload: CreatePollInput, creatorId: string, workspaceId?: IdLike) {
    // The REST route already rejects this field-by-field (createPollRequestSchema);
    // repeated here so no caller can persist a live assessment nobody can score.
    if (payload.pollType === 'TRIAL' && payload.isPublished) {
      assertQuestionsGradeable(payload.questions);
    }

    const newPoll = await PollModel.create({
      ...payload,
      expiresAt: new Date(payload.expiresAt),
      creatorId,
      workspaceId: workspaceId ?? (await this.defaultCreateWorkspace(creatorId)),
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

  /**
   * Copies a poll into `workspaceId` as an unpublished draft: title "Copy of
   * …", questions (options, answers, points, explanations), pollType, pass
   * mark and anonymity. Never its responses: the copy starts with zeroed
   * analytics, open and with results unpublished, expiring per
   * `duplicateExpiresAt`. The caller has authorized both the read of the
   * source and the create in `workspaceId`.
   */
  static async duplicatePoll(source: IPoll, creatorId: string, workspaceId: IdLike, now = new Date()) {
    const expiresAt = duplicateExpiresAt(source.expiresAt, now);
    return this.createPoll(
      {
        title: copyTitle(source.title),
        pollType: source.pollType,
        passingScorePercentage: source.passingScorePercentage,
        isAnonymous: source.isAnonymous,
        expiresAt: expiresAt.toISOString(),
        isPublished: false,
        questions: source.questions.map((question) => ({
          text: question.text,
          options: [...question.options],
          type: question.type ?? 'single',
          correctOptionIndices: [...(question.correctOptionIndices ?? [])],
          explanation: question.explanation ?? '',
          points: question.points ?? 1,
          isMandatory: question.isMandatory ?? true,
        })),
      },
      creatorId,
      workspaceId,
    );
  }

  static async getPollById(pollId: string) {
    const poll = await PollModel.findById(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }
    return poll;
  }

  /**
   * Polls of one workspace, newest first. Polls from before migration 020 have
   * no workspace yet; their creator sees them in their personal workspace,
   * where the migration puts them.
   */
  static async listPolls({ userId, workspace }: PollListScope) {
    const isOwnPersonal = workspace.type === 'personal' && String(workspace.ownerId) === userId;
    const filter = isOwnPersonal
      ? { $or: [{ workspaceId: workspace._id }, { workspaceId: null, creatorId: userId }] }
      : { workspaceId: workspace._id };
    return PollModel.find(filter).sort({ createdAt: -1 });
  }

  private static async defaultCreateWorkspace(creatorId: string) {
    const context = await resolveWorkspaceContext(creatorId);
    assertCan({ user: { id: creatorId }, ...context }, 'deck:create');
    return context.workspace._id;
  }

  static async updatePoll(pollId: string, payload: UpdatePollInput) {
    const poll = await this.getPollById(pollId);

    if (poll.isClosed) {
      throw ApiError.badRequest('Closed polls cannot be updated');
    }

    // Judge gradeability on the poll as it will be AFTER this update, which needs
    // the stored values: a PATCH carrying only { isPublished: true } can put an
    // answerless TRIAL draft live, and one carrying only questions can strip the
    // answers from a live assessment. Updates that touch none of these fields are
    // left alone so an unrelated edit is never blocked by pre-existing data.
    const nextType = payload.pollType ?? poll.pollType;
    const nextPublished = payload.isPublished ?? poll.isPublished;
    const touchesGrading =
      payload.questions !== undefined || payload.pollType !== undefined || payload.isPublished !== undefined;
    if (nextType === 'TRIAL' && nextPublished && touchesGrading) {
      assertQuestionsGradeable(payload.questions ?? poll.questions);
    }

    if (payload.title !== undefined) poll.title = payload.title;
    if (payload.pollType !== undefined) poll.pollType = payload.pollType;
    if (payload.passingScorePercentage !== undefined) poll.passingScorePercentage = payload.passingScorePercentage;
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