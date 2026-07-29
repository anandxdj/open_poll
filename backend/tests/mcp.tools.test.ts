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

/**
 * Runs create_poll against a stubbed PollModel and returns the payload the
 * service handed to the database, so tests can assert on what actually persists.
 */
async function captureCreate(args: Record<string, unknown>) {
  const originalCreate = PollModel.create;
  const originalAnalyticsCreate = AnalyticsModel.create;
  let createdPayload: any;

  (PollModel as any).create = async (data: unknown) => {
    createdPayload = data;
    return fakePoll({ ...(data as object), creatorId: OWNER_ID });
  };
  (AnalyticsModel as any).create = async (data: unknown) => data;

  try {
    await handleMcpTool('create_poll', args, {
      userId: OWNER_ID,
      tokenId: 't1',
      scopes: ['poll:create'],
    });
  } catch (error) {
    (PollModel as any).create = originalCreate;
    (AnalyticsModel as any).create = originalAnalyticsCreate;
    throw error;
  }

  return {
    createdPayload,
    restore() {
      (PollModel as any).create = originalCreate;
      (AnalyticsModel as any).create = originalAnalyticsCreate;
    },
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

  it('applies REST-schema defaults when the optional fields are omitted on create_poll', async () => {
    const { createdPayload, restore } = await captureCreate({
      title: 'MCP-created poll',
      questions: [{ text: 'Pick one', options: ['A', 'B'] }],
    });

    expect(createdPayload.pollType).toBe('POLL');
    expect(createdPayload.passingScorePercentage).toBe(70);
    expect(createdPayload.isPublished).toBe(true);
    expect(createdPayload.questions[0].type).toBe('single');
    expect(createdPayload.questions[0].correctOptionIndices).toEqual([]);

    restore();
  });
});

describe('handleMcpTool assessment (TRIAL) support', () => {
  it('creates a graded TRIAL and preserves the supplied assessment fields', async () => {
    const { createdPayload, restore } = await captureCreate({
      title: 'TypeScript Fundamentals',
      pollType: 'TRIAL',
      passingScorePercentage: 80,
      questions: [
        {
          text: 'Which keyword declares a constant?',
          options: ['let', 'const', 'var'],
          type: 'single',
          correctOptionIndices: [1],
          explanation: 'const creates a binding that cannot be reassigned.',
          points: 5,
        },
        {
          text: 'Which are primitive types?',
          options: ['string', 'number', 'Array'],
          type: 'multiple',
          correctOptionIndices: [0, 1],
        },
      ],
    });

    expect(createdPayload.pollType).toBe('TRIAL');
    expect(createdPayload.passingScorePercentage).toBe(80);
    expect(createdPayload.questions[0].correctOptionIndices).toEqual([1]);
    expect(createdPayload.questions[0].explanation).toBe('const creates a binding that cannot be reassigned.');
    expect(createdPayload.questions[0].points).toBe(5);
    expect(createdPayload.questions[1].type).toBe('multiple');
    expect(createdPayload.questions[1].correctOptionIndices).toEqual([0, 1]);
    // Unsupplied per-question fields still fall through to the REST defaults.
    expect(createdPayload.questions[1].points).toBe(1);
    expect(createdPayload.questions[1].explanation).toBe('');

    restore();
  });

  it('rejects a TRIAL whose questions have no correct answers', async () => {
    await expect(
      handleMcpTool(
        'create_poll',
        {
          title: 'Ungradeable assessment',
          pollType: 'TRIAL',
          questions: [{ text: 'Pick one', options: ['A', 'B'] }],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/at least one correct option index/i);
  });

  it('rejects a correctOptionIndices entry that is out of range for its options', async () => {
    await expect(
      handleMcpTool(
        'create_poll',
        {
          title: 'Out of range assessment',
          pollType: 'TRIAL',
          questions: [{ text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [5] }],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/only has 2 options/i);
  });

  it('rejects a "single" question that declares more than one correct option', async () => {
    await expect(
      handleMcpTool(
        'create_poll',
        {
          title: 'Contradictory assessment',
          pollType: 'TRIAL',
          questions: [
            { text: 'Pick one', options: ['A', 'B', 'C'], type: 'single', correctOptionIndices: [0, 1] },
          ],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/at most one correct option/i);
  });

  it('rejects promoting a poll to a TRIAL without resupplying questions', async () => {
    const poll = fakePoll({ creatorId: OWNER_ID });
    const originalFindById = PollModel.findById;
    (PollModel as any).findById = async () => poll;

    await expect(
      handleMcpTool(
        'edit_poll',
        { pollId: String(poll._id), pollType: 'TRIAL' },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
      ),
    ).rejects.toThrow(/requires resupplying questions/i);

    (PollModel as any).findById = originalFindById;
  });

  it('promotes a poll to a TRIAL when gradeable questions are supplied', async () => {
    const originalFindById = PollModel.findById;
    const originalAnalyticsFindOne = AnalyticsModel.findOne;

    // PollService.updatePoll mutates the document in place and calls save(),
    // so the stub has to be the object we later assert against.
    const stored: any = {
      ...fakePoll({ creatorId: OWNER_ID, pollType: 'POLL', passingScorePercentage: 70 }),
      save: async () => stored,
    };
    (PollModel as any).findById = async () => stored;
    (AnalyticsModel as any).findOne = async () => null;

    await handleMcpTool(
      'edit_poll',
      {
        pollId: String(stored._id),
        pollType: 'TRIAL',
        passingScorePercentage: 90,
        questions: [
          { text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [0], explanation: 'A is right.' },
        ],
      },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
    );

    expect(stored.pollType).toBe('TRIAL');
    expect(stored.passingScorePercentage).toBe(90);
    expect(stored.questions[0].correctOptionIndices).toEqual([0]);
    expect(stored.questions[0].explanation).toBe('A is right.');

    (PollModel as any).findById = originalFindById;
    (AnalyticsModel as any).findOne = originalAnalyticsFindOne;
  });
});
