import { describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { PollService } from '../src/modules/polls/polls.service';
import { ResponseService } from '../src/modules/responses/responses.service';
import { PollModel } from '../src/modules/polls/polls.model';
import { ResponseModel } from '../src/modules/responses/responses.model';
import { redisClient } from '../src/common/config/redis';

describe('backend mvp smoke tests', () => {
  it('creates a poll through PollService', async () => {
    const originalCreate = PollModel.create;
    (PollModel as any).create = async (data: unknown) => data;

    const created = await PollService.createPoll(
      {
        title: 'Backend MVP Poll',
        isAnonymous: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        isPublished: true,
        questions: [
          {
            text: 'Best runtime?',
            options: ['Bun', 'Node'],
            isMandatory: true,
          },
        ],
      },
      'mock-creator-id-123',
    );

    expect((created as any).creatorId).toBe('mock-creator-id-123');
    (PollModel as any).create = originalCreate;
  });

  it('submits response and publishes analytics event', async () => {
    const pollId = new mongoose.Types.ObjectId();
    const questionId = new mongoose.Types.ObjectId();

    const originalPollFindById = PollModel.findById;
    const originalResponseCreate = ResponseModel.create;
    const originalResponseFind = ResponseModel.find;
    const originalPublish = redisClient.publish;

    (PollModel as any).findById = async () => ({
      _id: pollId,
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

    (ResponseModel as any).create = async (payload: unknown) => payload;
    (ResponseModel as any).find = async () => [
      {
        answers: [{ questionId, selectedOptionIndex: 0 }],
      },
    ];
    (redisClient as any).publish = async () => 1;

    const result = await ResponseService.submitResponse({
      pollId: String(pollId),
      answers: [{ questionId: String(questionId), selectedOptionIndex: 0 }],
    });

    expect((result as any).answers.length).toBe(1);

    (PollModel as any).findById = originalPollFindById;
    (ResponseModel as any).create = originalResponseCreate;
    (ResponseModel as any).find = originalResponseFind;
    (redisClient as any).publish = originalPublish;
  });
});
