import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { redisClient } from '../../src/common/config/redis';
import { AnalyticsModel } from '../../src/modules/responses/analytics.model';
import { ResponseService } from '../../src/modules/responses/responses.service';
import { runAnalyticsTick } from '../../src/modules/responses/analytics.worker';
import { createPoll, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * The poll analytics worker finds a poll's buffered counters through the
 * poll's own SET of question ids, never through `KEYS` (which blocks Redis for
 * every other instance and every live session sharing it).
 */
describeIntegration('analytics worker without KEYS', () => {
  let server: TestServer;
  let owner: TestUser;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    owner = await createVerifiedUser({ name: 'Owner' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  const buffer = (pollId: string, answers: { questionId: string; selectedOptionIndices: number[] }[]) =>
    (ResponseService as unknown as { bufferVoteCounts(pollId: string, answers: unknown[]): Promise<void> }).bufferVoteCounts(
      pollId,
      answers
    );

  it('flushes buffered votes found through the per-poll set, and leaves later votes alone', async () => {
    const poll = await createPoll(server, owner, {
      questions: [
        { text: 'Best runtime?', options: ['Bun', 'Node'], type: 'single' },
        { text: 'Best database?', options: ['Mongo', 'Postgres', 'SQLite'], type: 'single' },
      ],
    });
    const pollId = String(poll._id);
    const [q1, q2] = poll.questions.map((q: { _id: string }) => String(q._id)) as [string, string];
    await ResponseService.getPollAnalytics(pollId); // materializes the analytics document

    await buffer(pollId, [
      { questionId: q1, selectedOptionIndices: [0] },
      { questionId: q2, selectedOptionIndices: [2] },
    ]);
    await buffer(pollId, [
      { questionId: q1, selectedOptionIndices: [0] },
      { questionId: q2, selectedOptionIndices: [1] },
    ]);
    expect((await redisClient.sMembers(`buffer:poll:${pollId}:questions`)).sort()).toEqual([q1, q2].sort());

    // The worker may not scan keys: any KEYS call fails the tick.
    const original = redisClient.keys;
    (redisClient as { keys: unknown }).keys = () => {
      throw new Error('KEYS is not allowed');
    };
    try {
      expect(await runAnalyticsTick()).toBe(pollId);
    } finally {
      (redisClient as { keys: unknown }).keys = original;
    }

    const analytics = await AnalyticsModel.findOne({ pollId }).lean();
    expect(analytics!.totalResponses).toBe(2);
    const counts = Object.fromEntries(analytics!.questionSummaries.map((s) => [String(s.questionId), s.counts]));
    expect(counts[q1]!.slice(0, 2)).toEqual([2, 0]);
    expect(counts[q2]!.slice(0, 3)).toEqual([0, 1, 1]);
    // Everything it flushed is gone: counters, the set and the totals; nothing else is queued.
    expect(await redisClient.sMembers(`buffer:poll:${pollId}:questions`)).toEqual([]);
    expect(await redisClient.exists([`buffer:poll:${pollId}:question:${q1}`, `buffer:poll:${pollId}:question:${q2}`, `buffer:poll:${pollId}:total`])).toBe(0);
    expect(await runAnalyticsTick()).toBeNull();

    // A vote that arrives after the flush starts a fresh buffer and is picked up by the next tick.
    await buffer(pollId, [{ questionId: q1, selectedOptionIndices: [1] }]);
    expect(await runAnalyticsTick()).toBe(pollId);
    expect((await AnalyticsModel.findOne({ pollId }).lean())!.totalResponses).toBe(3);
  });
});
