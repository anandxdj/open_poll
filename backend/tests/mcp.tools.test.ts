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
 * Runs a create tool against a stubbed PollModel and returns both the payload the
 * service handed to the database and the tool's own result, so tests can assert on
 * what persists and on what the agent is told.
 */
async function captureCreate(tool: string, args: Record<string, unknown>) {
  const originalCreate = PollModel.create;
  const originalAnalyticsCreate = AnalyticsModel.create;
  let createdPayload: any;

  (PollModel as any).create = async (data: unknown) => {
    createdPayload = data;
    return fakePoll({ ...(data as object), creatorId: OWNER_ID });
  };
  (AnalyticsModel as any).create = async (data: unknown) => data;

  let result: any;
  try {
    result = await handleMcpTool(tool, args, {
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
    result,
    restore() {
      (PollModel as any).create = originalCreate;
      (AnalyticsModel as any).create = originalAnalyticsCreate;
    },
  };
}

/** Stubs an existing stored poll for the edit/convert paths. */
function stubStoredPoll(overrides: Record<string, unknown> = {}) {
  const originalFindById = PollModel.findById;
  const originalAnalyticsFindOne = AnalyticsModel.findOne;

  // PollService.updatePoll mutates the document in place and calls save(),
  // so the stub has to be the object we later assert against.
  const stored: any = { ...fakePoll(overrides), save: async () => stored };
  (PollModel as any).findById = async () => stored;
  (AnalyticsModel as any).findOne = async () => null;

  return {
    stored,
    restore() {
      (PollModel as any).findById = originalFindById;
      (AnalyticsModel as any).findOne = originalAnalyticsFindOne;
    },
  };
}

describe('handleMcpTool scope enforcement', () => {
  it('rejects a tool call missing the required scope', async () => {
    await expect(
      handleMcpTool('list_polls', {}, { userId: OWNER_ID, tokenId: 't1', scopes: [] }),
    ).rejects.toThrow('Missing required scope: poll:read');
  });

  it('rejects a tool name absent from the scope map', async () => {
    await expect(
      handleMcpTool('delete_everything', {}, { userId: OWNER_ID, tokenId: 't1', scopes: [] }),
    ).rejects.toThrow('Unknown MCP tool: delete_everything');
  });

  it('requires poll:create for create_assessment', async () => {
    await expect(
      handleMcpTool('create_assessment', {}, { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:read'] }),
    ).rejects.toThrow('Missing required scope: poll:create');
  });

  it('requires poll:edit for convert_poll_to_assessment', async () => {
    await expect(
      handleMcpTool(
        'convert_poll_to_assessment',
        {},
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow('Missing required scope: poll:edit');
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
    const { createdPayload, restore } = await captureCreate('create_poll', {
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

describe('create_poll is ungraded-only', () => {
  // The whole point of splitting the tools: create_poll's schema has no answer
  // fields, so it cannot produce a graded assessment even if an agent tries.
  it('ignores pollType and answer fields smuggled into create_poll', async () => {
    const { createdPayload, restore } = await captureCreate('create_poll', {
      title: 'Trying to sneak a quiz through',
      pollType: 'TRIAL',
      passingScorePercentage: 90,
      questions: [
        { text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [0], points: 9 },
      ],
    });

    expect(createdPayload.pollType).toBe('POLL');
    expect(createdPayload.questions[0].correctOptionIndices).toEqual([]);
    expect(createdPayload.questions[0].points).toBe(1);
    // passingScorePercentage is not in the tool's schema, so the REST default stands.
    expect(createdPayload.passingScorePercentage).toBe(70);

    restore();
  });

  it('returns no grading summary for an ungraded poll', async () => {
    const { result, restore } = await captureCreate('create_poll', {
      title: 'An ordinary poll',
      questions: [{ text: 'Pick one', options: ['A', 'B'] }],
    });

    expect(result.grading).toBeUndefined();
    restore();
  });
});

describe('create_assessment', () => {
  it('creates a graded TRIAL and preserves the supplied assessment fields', async () => {
    const { createdPayload, restore } = await captureCreate('create_assessment', {
      title: 'TypeScript Fundamentals',
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

  // A valid index can still be the wrong answer, so the tool reports back which
  // option text each index actually resolved to.
  it('echoes correct answers back resolved to option text', async () => {
    const { result, restore } = await captureCreate('create_assessment', {
      title: 'Solar System',
      passingScorePercentage: 60,
      questions: [
        {
          text: 'Which planet is closest to the Sun?',
          options: ['Mercury', 'Venus', 'Earth'],
          type: 'single',
          correctOptionIndices: [0],
          points: 5,
        },
        {
          text: 'Which of these are gas giants?',
          options: ['Jupiter', 'Saturn', 'Mercury'],
          type: 'multiple',
          correctOptionIndices: [0, 1],
          points: 5,
        },
      ],
    });

    expect(result.grading.gradeable).toBe(true);
    expect(result.grading.maxScore).toBe(10);
    expect(result.grading.questions[0].correctAnswers).toEqual(['Mercury']);
    expect(result.grading.questions[1].correctAnswers).toEqual(['Jupiter', 'Saturn']);

    restore();
  });

  it('rejects an assessment whose questions have no correct answers', async () => {
    await expect(
      handleMcpTool(
        'create_assessment',
        {
          title: 'Ungradeable assessment',
          questions: [{ text: 'Pick one', options: ['A', 'B'] }],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/correctOptionIndices/i);
  });

  it('rejects an empty correctOptionIndices array', async () => {
    await expect(
      handleMcpTool(
        'create_assessment',
        {
          title: 'Empty answers assessment',
          questions: [{ text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [] }],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/correctOptionIndices/i);
  });

  it('rejects a correctOptionIndices entry that is out of range for its options', async () => {
    await expect(
      handleMcpTool(
        'create_assessment',
        {
          title: 'Out of range assessment',
          questions: [{ text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [5] }],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/only has 2 options/i);
  });

  it('rejects a "single" question that declares more than one correct option', async () => {
    await expect(
      handleMcpTool(
        'create_assessment',
        {
          title: 'Contradictory assessment',
          questions: [
            { text: 'Pick one', options: ['A', 'B', 'C'], type: 'single', correctOptionIndices: [0, 1] },
          ],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:create'] },
      ),
    ).rejects.toThrow(/at most one correct option/i);
  });
});

describe('convert_poll_to_assessment', () => {
  it('rejects a conversion that does not resupply questions', async () => {
    const { stored, restore } = stubStoredPoll({ pollType: 'POLL' });

    await expect(
      handleMcpTool(
        'convert_poll_to_assessment',
        { pollId: String(stored._id) },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
      ),
    ).rejects.toThrow(/questions/i);

    restore();
  });

  it('converts a poll to a graded assessment and reports the resolved answers', async () => {
    const { stored, restore } = stubStoredPoll({ pollType: 'POLL', passingScorePercentage: 70 });

    const result: any = await handleMcpTool(
      'convert_poll_to_assessment',
      {
        pollId: String(stored._id),
        passingScorePercentage: 90,
        questions: [
          {
            text: 'Best street food?',
            options: ['Tacos', 'Samosa'],
            correctOptionIndices: [1],
            explanation: 'Samosa wins.',
          },
        ],
      },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
    );

    expect(stored.pollType).toBe('TRIAL');
    expect(stored.passingScorePercentage).toBe(90);
    expect(stored.questions[0].correctOptionIndices).toEqual([1]);
    expect(stored.questions[0].explanation).toBe('Samosa wins.');
    expect(result.grading.correctAnswers ?? result.grading.questions[0].correctAnswers).toEqual(['Samosa']);

    restore();
  });

  it('refuses to convert a poll owned by another user', async () => {
    const { stored, restore } = stubStoredPoll({ creatorId: OTHER_ID });

    await expect(
      handleMcpTool(
        'convert_poll_to_assessment',
        {
          pollId: String(stored._id),
          questions: [{ text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [0] }],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
      ),
    ).rejects.toThrow('You do not have permission to access this poll');

    restore();
  });
});

describe('edit_poll keeps an existing assessment gradeable', () => {
  // Regression: the old rule only fired when the CALLER passed pollType TRIAL, so
  // replacing a stored TRIAL's questions with answerless ones silently made a live
  // assessment ungradeable. The stored type is only knowable after the fetch.
  it('rejects answerless questions when the stored poll is already an assessment', async () => {
    const { stored, restore } = stubStoredPoll({ pollType: 'TRIAL' });

    await expect(
      handleMcpTool(
        'edit_poll',
        {
          pollId: String(stored._id),
          questions: [
            { text: 'Pick one', options: ['A', 'B'] },
            { text: 'Pick another', options: ['C', 'D'], correctOptionIndices: [0] },
          ],
        },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
      ),
    ).rejects.toThrow(/Missing on question\(s\): 1/);

    restore();
  });

  it('allows answerless questions on an ungraded poll', async () => {
    const { stored, restore } = stubStoredPoll({ pollType: 'POLL' });

    const result: any = await handleMcpTool(
      'edit_poll',
      {
        pollId: String(stored._id),
        questions: [{ text: 'Pick one', options: ['A', 'B'] }],
      },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
    );

    expect(stored.questions[0].text).toBe('Pick one');
    expect(result.grading).toBeUndefined();

    restore();
  });

  it('updates an assessment when every question keeps its answers', async () => {
    const { stored, restore } = stubStoredPoll({ pollType: 'TRIAL', passingScorePercentage: 70 });

    const result: any = await handleMcpTool(
      'edit_poll',
      {
        pollId: String(stored._id),
        passingScorePercentage: 55,
        questions: [
          { text: 'Capital of France?', options: ['Paris', 'Lyon'], correctOptionIndices: [0], points: 2 },
        ],
      },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
    );

    expect(stored.passingScorePercentage).toBe(55);
    expect(result.grading.gradeable).toBe(true);
    expect(result.grading.questions[0].correctAnswers).toEqual(['Paris']);

    restore();
  });

  it('cannot change pollType, since promotion belongs to convert_poll_to_assessment', async () => {
    const { stored, restore } = stubStoredPoll({ pollType: 'POLL' });

    await handleMcpTool(
      'edit_poll',
      { pollId: String(stored._id), pollType: 'TRIAL', title: 'Renamed poll' },
      { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
    );

    expect(stored.title).toBe('Renamed poll');
    expect(stored.pollType).toBe('POLL');

    restore();
  });

  it('still requires at least one field besides pollId', async () => {
    const { stored, restore } = stubStoredPoll();

    await expect(
      handleMcpTool(
        'edit_poll',
        { pollId: String(stored._id) },
        { userId: OWNER_ID, tokenId: 't1', scopes: ['poll:edit'] },
      ),
    ).rejects.toThrow(/At least one field besides pollId/i);

    restore();
  });
});
