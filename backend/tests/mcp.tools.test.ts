import { describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import { handleMcpTool } from '../src/modules/mcp/mcp.tools';
import { PollModel } from '../src/modules/polls/polls.model';
import { AnalyticsModel } from '../src/modules/responses/analytics.model';

const OWNER_ID = 'owner-user-id';
const OTHER_ID = 'other-user-id';

function fakePoll(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    creatorId: OWNER_ID,
    title: 'A poll',
    isPublished: true,
    isClosed: false,
    questions: [],
    ...overrides,
  };
}

describe('handleMcpTool scope enforcement', () => {
  it('rejects a tool call missing the required scope', async () => {
    await expect(
      handleMcpTool('list_polls', {}, { userId: OWNER_ID, tokenId: 't1', scopes: [] }),
    ).rejects.toThrow('Missing required scope: poll:read');
  });
});

describe('handleMcpTool owner enforcement', () => {
  it('rejects get_poll for a poll owned by another user', async () => {
    const poll = fakePoll({ creatorId: OTHER_ID });
    const originalFindById = PollModel.findById;
    (PollModel as any).findById = async () => poll;

    await expect(
      handleMcpTool(
        'get_poll',
        { pollId: String(poll._id) },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:read'] },
      ),
    ).rejects.toThrow('You do not have permission to access this poll');

    (PollModel as any).findById = originalFindById;
  });

  it('allows get_poll for the owning user', async () => {
    const poll = fakePoll({ creatorId: OWNER_ID });
    const originalFindById = PollModel.findById;
    (PollModel as any).findById = async () => poll;

    const result = await handleMcpTool(
      'get_poll',
      { pollId: String(poll._id) },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:read'] },
    );

    expect((result as any).poll.title).toBe('A poll');
    (PollModel as any).findById = originalFindById;
  });
});

describe('handleMcpTool input validation', () => {
  it('rejects a malformed pollId before hitting the database', async () => {
    await expect(
      handleMcpTool(
        'get_poll',
        { pollId: 'not-a-valid-object-id' },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:read'] },
      ),
    ).rejects.toThrow('Invalid poll ID');
  });

  it('applies REST-schema defaults (pollType, question type, etc.) on create_poll', async () => {
    const originalCreate = PollModel.create;
    const originalAnalyticsCreate = AnalyticsModel.create;
    let createdPayload: any;
    (PollModel as any).create = async (data: unknown) => {
      createdPayload = data;
      return fakePoll({ ...(data as object), creatorId: OWNER_ID });
    };
    (AnalyticsModel as any).create = async (data: unknown) => data;

    await handleMcpTool(
      'create_poll',
      {
        title: 'MCP-created poll',
        questions: [{ text: 'Pick one', options: ['A', 'B'] }],
      },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
    );

    expect(createdPayload.pollType).toBe('POLL');
    expect(createdPayload.passingScorePercentage).toBe(70);
    expect(createdPayload.isPublished).toBe(true);
    expect(createdPayload.questions[0].type).toBe('single');
    expect(createdPayload.questions[0].correctOptionIndices).toEqual([]);

    (PollModel as any).create = originalCreate;
    (AnalyticsModel as any).create = originalAnalyticsCreate;
  });
});
