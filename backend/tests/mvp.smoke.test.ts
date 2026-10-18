import { describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { PollService } from '../src/modules/polls/polls.service';
import { ResponseService } from '../src/modules/responses/responses.service';
import { PollModel } from '../src/modules/polls/polls.model';
import { ResponseModel } from '../src/modules/responses/responses.model';
import { redisClient } from '../src/common/config/redis';
import { AnalyticsModel } from '../src/modules/responses/analytics.model';
import { issueBallotToken } from '../src/common/utils/signedId.utils';

describe('backend mvp smoke tests', () => {
  it('creates a poll through PollService', async () => {
    const originalCreate = PollModel.create;
    const originalAnalyticsCreate = AnalyticsModel.create;
    (PollModel as any).create = async (data: unknown) => data;
    (AnalyticsModel as any).create = async (data: unknown) => data;

    const created = await PollService.createPoll(
      {
        title: 'Backend MVP Poll',
        pollType: 'POLL',
        passingScorePercentage: 70,
        isAnonymous: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        isPublished: true,
        questions: [
          {
            text: 'Best runtime?',
            options: ['Bun', 'Node'],
            type: 'single',
            correctOptionIndices: [],
            explanation: '',
            points: 1,
            isMandatory: true,
          },
        ],
      },
      'mock-creator-id-123',
    );

    expect((created as any).creatorId).toBe('mock-creator-id-123');
    (PollModel as any).create = originalCreate;
    (AnalyticsModel as any).create = originalAnalyticsCreate;
  });

  it('submitting a response buffers vote counts and queues async persist', async () => {
    const questionId = new mongoose.Types.ObjectId();
    const pollId = new mongoose.Types.ObjectId();

    const originalPollFindById = PollModel.findById;
    const originalResponseCreate = ResponseModel.create;
    const originalResponseFind = ResponseModel.find;
    const originalPublish = redisClient.publish;
    const originalGet = redisClient.get;
    const originalSet = redisClient.set;
    const originalMulti = redisClient.multi;

    (PollModel as any).findById = async () => ({
      _id: pollId,
      creatorId: 'mock-creator-id-123',
      title: 'Backend MVP Poll',
      pollType: 'POLL',
      isAnonymous: true,
      isPublished: true,
      isClosed: false,
      expiresAt: new Date(Date.now() + 60_000),
      questions: [
        {
          _id: questionId,
          text: 'Best runtime?',
          options: ['Bun', 'Node'],
          isMandatory: true,
        },
      ],
    });

    (ResponseModel as any).create = async (data: unknown) => data;

    Object.defineProperty(redisClient, 'isOpen', { value: true, configurable: true, writable: true });
    (redisClient as any).get = async () => null;
    // SET ... NX returns 'OK' on first use — the single-use ballot check passes
    (redisClient as any).set = async () => 'OK';
    (redisClient as any).multi = () => ({
      sAdd: () => undefined,
      incr: () => undefined,
      hIncrBy: () => undefined,
      exec: async () => [],
    });
    (redisClient as any).publish = async () => 1;

    const { token: ballotToken } = issueBallotToken(String(pollId));
    const result = await ResponseService.submitResponse({
      pollId: String(pollId),
      ballotToken,
      answers: [{ questionId: String(questionId), selectedOptionIndex: 0 }],
    });

    expect((result as any).message).toBe('Response recorded successfully');

    (PollModel as any).findById = originalPollFindById;
    (ResponseModel as any).create = originalResponseCreate;
    (ResponseModel as any).find = originalResponseFind;
    (redisClient as any).publish = originalPublish;
    (redisClient as any).get = originalGet;
    (redisClient as any).set = originalSet;
    (redisClient as any).multi = originalMulti;
  });
});
