import { describe, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import pollsRouter from '../src/modules/polls/polls.route';
import { createPollRequestSchema } from '../src/modules/polls/polls.schema';
import { assertQuestionsGradeable } from '../src/modules/polls/polls.grading';
import { PollService } from '../src/modules/polls/polls.service';
import { PollModel } from '../src/modules/polls/polls.model';
import { AnalyticsModel } from '../src/modules/responses/analytics.model';
import { generatedPollSchema } from '../src/modules/ai/ai.schema';

const futureIso = () => new Date(Date.now() + 86_400_000).toISOString();

function trialBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Capitals quiz',
    pollType: 'TRIAL',
    isPublished: true,
    expiresAt: futureIso(),
    questions: [{ text: 'Capital of France?', options: ['Paris', 'Lyon'], correctOptionIndices: [0] }],
    ...overrides,
  };
}

/** Runs the validate middleware mounted on POST /api/polls, skipping authenticate(). */
function runCreateValidation(body: unknown): { error?: any; body?: any } {
  const layer = (pollsRouter as any).stack.find(
    (l: any) => l.route?.path === '/' && l.route.methods?.post,
  );
  const handlers = layer.route.stack.map((s: any) => s.handle);
  // [authenticate, validate, controller]
  const validateHandler = handlers[1];
  const req: any = { body };
  let error: any;
  validateHandler(req, {}, (err?: unknown) => {
    error = err;
  });
  return error ? { error } : { body: req.body };
}

describe('createPollRequestSchema (POST /api/polls)', () => {
  it('rejects a published TRIAL with an answerless question, naming the field', () => {
    const result = createPollRequestSchema.safeParse(
      trialBody({ questions: [{ text: 'Pick one', options: ['A', 'B'] }] }),
    );

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path).toEqual(['questions', 0, 'correctOptionIndices']);
    expect(result.error!.issues[0]!.message).toMatch(/at least one correct option/);
  });

  it('rejects a published TRIAL whose correct index is out of range', () => {
    const result = createPollRequestSchema.safeParse(
      trialBody({ questions: [{ text: 'Pick one', options: ['A', 'B'], correctOptionIndices: [2] }] }),
    );

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/only has 2 options/);
  });

  it('rejects a "single" question with more than one correct index', () => {
    const result = createPollRequestSchema.safeParse(
      trialBody({
        questions: [{ text: 'Pick one', options: ['A', 'B', 'C'], type: 'single', correctOptionIndices: [0, 1] }],
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/at most one correct option/);
  });

  it('accepts a gradeable published TRIAL', () => {
    expect(createPollRequestSchema.safeParse(trialBody()).success).toBe(true);
  });

  // The web builder autosaves TRIAL drafts before any answer is marked.
  it('accepts an answerless TRIAL draft', () => {
    const result = createPollRequestSchema.safeParse(
      trialBody({ isPublished: false, questions: [{ text: 'Pick one', options: ['A', 'B'] }] }),
    );
    expect(result.success).toBe(true);
  });

  it('leaves ungraded polls alone', () => {
    const result = createPollRequestSchema.safeParse(
      trialBody({ pollType: 'POLL', questions: [{ text: 'Pick one', options: ['A', 'B'] }] }),
    );
    expect(result.success).toBe(true);
  });

  it('is what the POST route actually validates with', () => {
    const rejected = runCreateValidation(trialBody({ questions: [{ text: 'Pick one', options: ['A', 'B'] }] }));
    expect(rejected.error?.statusCode).toBe(400);
    expect(rejected.error?.message).toMatch(/questions\.0\.correctOptionIndices/);

    const accepted = runCreateValidation(trialBody());
    expect(accepted.error).toBeUndefined();
    expect(accepted.body.questions[0].correctOptionIndices).toEqual([0]);
  });

  // The reason the refinement lives in a separate schema: ai.schema.ts picks off
  // createPollSchema, and zod throws on .pick() of a refined object.
  it('leaves createPollSchema pickable for the AI module', () => {
    expect(generatedPollSchema.shape.questions).toBeDefined();
  });
});

describe('assertQuestionsGradeable', () => {
  it('lists every answerless question by 1-based number', () => {
    expect(() =>
      assertQuestionsGradeable([
        { options: ['A', 'B'], correctOptionIndices: [] },
        { options: ['A', 'B'], correctOptionIndices: [1] },
        { options: ['A', 'B'] },
      ]),
    ).toThrow(/Missing on question\(s\): 1, 3\./);
  });

  it('rejects out-of-range indices with the question number', () => {
    expect(() => assertQuestionsGradeable([{ options: ['A', 'B'], correctOptionIndices: [4] }])).toThrow(
      /question 1: correctOptionIndices contains 4/,
    );
  });

  it('passes a gradeable question set', () => {
    expect(() =>
      assertQuestionsGradeable([{ options: ['A', 'B', 'C'], type: 'multiple', correctOptionIndices: [0, 2] }]),
    ).not.toThrow();
  });
});

/** Stubs the stored poll PollService.updatePoll fetches and saves in place. */
function stubStoredPoll(overrides: Record<string, unknown> = {}) {
  const originalFindById = PollModel.findById;
  const originalAnalyticsFindOne = AnalyticsModel.findOne;
  const stored: any = {
    _id: new mongoose.Types.ObjectId(),
    creatorId: 'owner',
    title: 'Stored',
    pollType: 'TRIAL',
    isPublished: true,
    isClosed: false,
    questions: [{ text: 'Q1', options: ['A', 'B'], correctOptionIndices: [0] }],
    ...overrides,
  };
  stored.save = async () => stored;
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

const answerless = [{ text: 'Q1', options: ['A', 'B'], type: 'single' as const, correctOptionIndices: [], explanation: '', points: 1, isMandatory: true }];

describe('PollService.updatePoll gradeability (PATCH /api/polls/:pollId)', () => {
  it('rejects stripping the answers from a live assessment', async () => {
    const { stored, restore } = stubStoredPoll();
    try {
      await expect(PollService.updatePoll(String(stored._id), { questions: answerless })).rejects.toThrow(
        /Missing on question\(s\): 1/,
      );
      expect(stored.questions[0].correctOptionIndices).toEqual([0]);
    } finally {
      restore();
    }
  });

  it('rejects publishing an answerless assessment draft using only { isPublished: true }', async () => {
    const { stored, restore } = stubStoredPoll({
      isPublished: false,
      questions: [{ text: 'Q1', options: ['A', 'B'], correctOptionIndices: [] }],
    });
    try {
      await expect(PollService.updatePoll(String(stored._id), { isPublished: true })).rejects.toThrow(
        /graded assessment/,
      );
      expect(stored.isPublished).toBe(false);
    } finally {
      restore();
    }
  });

  it('rejects promoting a live answerless poll to TRIAL using only { pollType }', async () => {
    const { stored, restore } = stubStoredPoll({
      pollType: 'POLL',
      questions: [{ text: 'Q1', options: ['A', 'B'], correctOptionIndices: [] }],
    });
    try {
      await expect(PollService.updatePoll(String(stored._id), { pollType: 'TRIAL' })).rejects.toThrow(
        /graded assessment/,
      );
      expect(stored.pollType).toBe('POLL');
    } finally {
      restore();
    }
  });

  it('rejects an out-of-range correct index on a live assessment', async () => {
    const { stored, restore } = stubStoredPoll();
    try {
      await expect(
        PollService.updatePoll(String(stored._id), {
          questions: [{ ...answerless[0]!, correctOptionIndices: [3] }],
        }),
      ).rejects.toThrow(/only has 2 options/);
    } finally {
      restore();
    }
  });

  it('lets an assessment draft be saved without answers', async () => {
    const { stored, restore } = stubStoredPoll({ isPublished: false });
    try {
      await PollService.updatePoll(String(stored._id), { questions: answerless });
      expect(stored.questions[0].correctOptionIndices).toEqual([]);
    } finally {
      restore();
    }
  });

  it('does not block an unrelated edit to a pre-existing ungradeable assessment', async () => {
    const { stored, restore } = stubStoredPoll({
      questions: [{ text: 'Q1', options: ['A', 'B'], correctOptionIndices: [] }],
    });
    try {
      await PollService.updatePoll(String(stored._id), { title: 'Renamed' });
      expect(stored.title).toBe('Renamed');
    } finally {
      restore();
    }
  });
});

describe('PollService.createPoll gradeability', () => {
  it('refuses to persist a published answerless assessment from any caller', async () => {
    const originalCreate = PollModel.create;
    let created = false;
    (PollModel as any).create = async () => {
      created = true;
    };
    try {
      await expect(
        PollService.createPoll(
          {
            title: 'Bypassing the route',
            pollType: 'TRIAL',
            passingScorePercentage: 70,
            isAnonymous: true,
            expiresAt: futureIso(),
            isPublished: true,
            questions: answerless,
          },
          'owner',
        ),
      ).rejects.toThrow(/graded assessment/);
      expect(created).toBe(false);
    } finally {
      (PollModel as any).create = originalCreate;
    }
  });
});
