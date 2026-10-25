import mongoose from 'mongoose';
import { redisClient } from '../../common/config/redis';
import { ApiError } from '../../common/utils/ApiError';
import {
  issueBallotToken,
  issueGuestToken,
  verifyBallotToken,
  verifyGuestToken,
} from '../../common/utils/signedId.utils';
import { PollModel, type IPoll } from '../polls/polls.model';
import { ResponseModel } from './responses.model';
import type { IssueGuestTokenInput, SubmitResponseInput } from './responses.schema';
import { AnalyticsModel } from './analytics.model';
import type { PollAnalyticsUpdateEvent } from '../../common/realtime/events';
import { UserModel } from '../auth/auth.model';
import { assertCan, type PolicyContext } from '../../common/tenancy/policy';
import { openPollResponseGate } from '../billing/pollCap';

// Dedup markers outlive the voting window by this much. Ballot tokens carry no
// expiry of their own, so a marker that lapsed while the poll is still open
// would let a spent ballot be replayed.
const VOTE_DEDUP_GRACE_SEC = 7 * 86400;
// Anonymous votes: a generous per-IP cap absorbs NAT while stopping bulk
// ballot-minting from one machine.
const ANON_VOTES_PER_IP = 50;
const ANON_VOTES_WINDOW_SEC = 86400;
// Serializes one respondent's trial attempts so the "already passed" check and
// attempt numbering can't race. Short so a crashed request can't wedge it.
const TRIAL_ATTEMPT_LOCK_SEC = 30;

/** Identity established by the transport layer — never read from the body. */
export type SubmitContext = {
  /** `req.user.id` from a verified access token. */
  userId?: string;
  clientIp?: string;
};

type NormalizedAnswer = {
  questionId: string;
  selectedOptionIndex: number;
  selectedOptionIndices: number[];
};

const dedupTtlSec = (expiresAt: Date) =>
  Math.ceil(Math.max(0, expiresAt.getTime() - Date.now()) / 1000) + VOTE_DEDUP_GRACE_SEC;

/** Atomic SET NX: true only for the one caller that created the key. */
const claimOnce = async (key: string, ttlSec: number) =>
  (await redisClient.set(key, '1', {
    condition: 'NX',
    expiration: { type: 'EX', value: ttlSec },
  })) !== null;

const toAnswerDocs = (answers: NormalizedAnswer[]) =>
  answers.map((a) => ({
    questionId: new mongoose.Types.ObjectId(a.questionId),
    selectedOptionIndex: a.selectedOptionIndex,
    selectedOptionIndices: a.selectedOptionIndices,
  }));

export class ResponseService {
  /**
   * Mints a server-signed, single-use ballot token bound to this poll.
   * The client cannot forge or rotate these — only the server can issue them.
   */
  static async issueBallot(pollId: string) {
    const poll = await PollModel.findById(pollId);
    if (!poll) throw ApiError.notFound('Poll not found');
    if (!poll.isPublished) throw ApiError.badRequest('Poll is not published');
    if (poll.isClosed) throw ApiError.badRequest('Poll is closed');
    if (poll.expiresAt.getTime() <= Date.now()) throw ApiError.badRequest('Poll is expired');

    // Bound to the canonical id so case variants of one ObjectId can't alias
    // into separate dedup keys.
    const { token } = issueBallotToken(String(poll._id));
    return { ballotToken: token };
  }

  /** Signs a guest identity so `guest:` respondent strings cannot be self-asserted. */
  static issueGuestIdentity(payload: IssueGuestTokenInput) {
    return { guestToken: issueGuestToken(payload.email, payload.name) };
  }

  static async submitResponse(payload: SubmitResponseInput, context: SubmitContext = {}) {
    const poll = await PollModel.findById(payload.pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }

    if (!poll.isPublished) {
      throw ApiError.badRequest('Poll is not published');
    }

    if (poll.isClosed) throw ApiError.badRequest('Poll is closed');
    if (poll.expiresAt.getTime() <= Date.now()) throw ApiError.badRequest('Poll is expired');

    const pollId = String(poll._id);
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
    const normalizedAnswers: NormalizedAnswer[] = payload.answers.map((answer) => {
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

    // Identity: derived server-side only. The verified session wins; a signed
    // guest token is the only other source. Raw client strings never are.
    let respondentId: string | null = context.userId ?? null;
    if (!respondentId && payload.guestToken) {
      const guest = verifyGuestToken(payload.guestToken);
      if (!guest) throw ApiError.unauthorized('Invalid guest token');
      respondentId = `guest:${guest.email}:${guest.name}`;
    }

    if (!poll.isAnonymous && !respondentId) {
      throw ApiError.unauthorized('This poll requires you to be logged in to vote.');
    }

    // Dedup anchor: the server-issued ballot, not any client-chosen string.
    // Every check above runs before it is spent, so a 401 → token refresh →
    // retry can resend the same ballot.
    const ballotId = verifyBallotToken(payload.ballotToken, pollId);
    if (!ballotId) throw ApiError.forbidden('Invalid or missing ballot token');

    // Plan response cap (billing/pollCap.ts): refuse a full poll before anything is spent.
    const responseGate = await openPollResponseGate(poll);

    const isTrial = poll.pollType === 'TRIAL';
    const dedupTtl = dedupTtlSec(poll.expiresAt);

    // Single use for every poll type — each trial retry fetches a fresh ballot.
    if (!(await claimOnce(`poll:${pollId}:ballot:${ballotId}`, dedupTtl))) {
      throw ApiError.conflict(
        isTrial ? 'This attempt was already submitted.' : 'You have already voted on this poll.',
      );
    }

    if (isTrial) {
      const releaseSlot = await responseGate.reserve();
      try {
        return await ResponseService.submitTrialAttempt(poll, normalizedAnswers, {
          respondentId,
          anonymousId: `anon:${ballotId}`,
          deviceHint: payload.deviceId,
          dedupTtl,
        });
      } catch (error) {
        await releaseSlot();
        throw error;
      }
    }

    // Secondary dedup, also atomic: an identity votes once whichever ballot it
    // holds; anonymous ballots are capped per IP.
    if (respondentId) {
      if (!(await claimOnce(`poll:${pollId}:voted:id:${respondentId}`, dedupTtl))) {
        throw ApiError.conflict('You have already voted on this poll.');
      }
    } else if (context.clientIp) {
      const ipKey = `poll:${pollId}:voted:ip:${context.clientIp}`;
      const ipVotes = await redisClient.incr(ipKey);
      if (ipVotes === 1) await redisClient.expire(ipKey, ANON_VOTES_WINDOW_SEC);
      if (ipVotes > ANON_VOTES_PER_IP) {
        throw ApiError.tooManyRequests('Too many votes from this network for this poll.');
      }
    }

    await responseGate.reserve();
    await ResponseService.bufferVoteCounts(pollId, normalizedAnswers);

    ResponseModel.create({
      pollId: new mongoose.Types.ObjectId(pollId),
      respondentId: respondentId ?? `anon:${ballotId}`,
      answers: toAnswerDocs(normalizedAnswers),
      attemptNumber: 1,
    }).catch((error: unknown) => {
      console.error('[Mongo Backup Error]', error);
    });

    return { message: 'Response recorded successfully' };
  }

  /**
   * Grades one trial attempt. Identified respondents may retry until they
   * pass; anonymous ones are bounded only by single-use ballots.
   */
  private static async submitTrialAttempt(
    poll: IPoll,
    normalizedAnswers: NormalizedAnswer[],
    opts: {
      respondentId: string | null;
      anonymousId: string;
      deviceHint?: string;
      dedupTtl: number;
    },
  ) {
    const pollId = String(poll._id);
    const pollObjectId = new mongoose.Types.ObjectId(pollId);
    const { respondentId } = opts;

    const lockKey = respondentId ? `poll:${pollId}:trial:lock:${respondentId}` : null;
    if (lockKey && !(await claimOnce(lockKey, TRIAL_ATTEMPT_LOCK_SEC))) {
      throw ApiError.conflict('Another attempt is already being graded.');
    }

    try {
      let attemptNumber = 1;
      if (respondentId) {
        if (await ResponseModel.exists({ pollId: pollObjectId, respondentId, passed: true })) {
          throw ApiError.conflict('You have already passed this assessment.');
        }
        attemptNumber =
          (await ResponseModel.countDocuments({ pollId: pollObjectId, respondentId })) + 1;
      } else if (opts.deviceHint) {
        // Display-only attempt counter for anonymous retries; gates nothing.
        const hintKey = `poll:${pollId}:trial:attempts:${opts.deviceHint}`;
        attemptNumber = await redisClient.incr(hintKey);
        if (attemptNumber === 1) await redisClient.expire(hintKey, opts.dedupTtl);
      }

      await ResponseService.bufferVoteCounts(pollId, normalizedAnswers);

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

      const trialResult = {
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

      // Awaited (unlike polls): the passed/attempt checks above read it back.
      await ResponseModel.create({
        pollId: pollObjectId,
        respondentId: respondentId ?? opts.anonymousId,
        answers: toAnswerDocs(normalizedAnswers),
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
    } finally {
      if (lockKey) await redisClient.del(lockKey).catch(() => {});
    }
  }

  /** Buffers per-option counts in Redis for the analytics worker to flush. */
  private static async bufferVoteCounts(pollId: string, answers: NormalizedAnswer[]) {
    const pipeline = redisClient.multi();
    pipeline.sAdd('buffer:active_polls', pollId);
    pipeline.incr(`buffer:poll:${pollId}:total`);
    for (const answer of answers) {
      // The worker finds a poll's counters through this set (no KEYS scan on a shared Redis).
      pipeline.sAdd(`buffer:poll:${pollId}:questions`, answer.questionId);
      for (const idx of answer.selectedOptionIndices) {
        pipeline.hIncrBy(
          `buffer:poll:${pollId}:question:${answer.questionId}`,
          String(idx),
          1,
        );
      }
    }
    await pipeline.exec();
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

  /** `context`: the caller in their current workspace (a request after workspaceContext()). */
  static async getPollResponsesList(pollId: string, context: PolicyContext) {
    const poll = await PollModel.findById(pollId);
    if (!poll) {
      throw ApiError.notFound('Poll not found');
    }

    assertCan(context, 'session:read', poll);

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

      // `anon:<ballotId>` marks a vote cast with no identity.
      if (!poll.isAnonymous && r.respondentId && !r.respondentId.startsWith('anon:')) {
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
