import { describe, expect, it } from 'bun:test';
import { ApiError } from '../src/common/utils/ApiError';
import { pollToDeckDraft } from '../src/modules/library/convert.service';

const question = (overrides: Record<string, unknown> = {}) => ({
  text: 'Favourite runtime?',
  options: ['Bun', 'Node', 'Deno'],
  type: 'single' as const,
  correctOptionIndices: [] as number[],
  explanation: '',
  points: 1,
  ...overrides,
});

const conversionError = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as ApiError;
  }
  throw new Error('expected the conversion to fail');
};

describe('pollToDeckDraft', () => {
  it('turns POLL questions into ungraded select_answer slides in an audience-paced deck', () => {
    const draft = pollToDeckDraft({
      title: 'Team survey',
      pollType: 'POLL',
      passingScorePercentage: 70,
      questions: [
        question(),
        question({ text: 'Which apply?', options: ['A', 'B'], type: 'multiple', correctOptionIndices: [0] }),
      ],
    });

    expect(draft.pace).toBe('audience');
    expect(draft.assessment).toBeNull();
    expect(draft.input.title).toBe('Team survey');
    expect(draft.input.slides).toHaveLength(2);
    expect(draft.input.slides[0]).toMatchObject({
      type: 'select_answer',
      question: 'Favourite runtime?',
      options: [
        { text: 'Bun', isCorrect: false },
        { text: 'Node', isCorrect: false },
        { text: 'Deno', isCorrect: false },
      ],
      points: 0,
      scoreDependsOnTime: false,
      timeLimit: 30,
      config: { allowMultiple: false, explanation: '' },
    });
    // A POLL has no answer key, even if stale correct indices were stored.
    expect(draft.input.slides[1]).toMatchObject({
      options: [
        { text: 'A', isCorrect: false },
        { text: 'B', isCorrect: false },
      ],
      config: { allowMultiple: true },
    });
  });

  it('maps a TRIAL: correct options, points, explanations and assessment settings', () => {
    const draft = pollToDeckDraft({
      title: 'Safety check',
      pollType: 'TRIAL',
      passingScorePercentage: 80,
      questions: [
        question({ correctOptionIndices: [1], points: 3, explanation: 'Node is the classic.' }),
        question({ type: 'multiple', correctOptionIndices: [0, 2], points: 2.4 }),
      ],
    });

    expect(draft.assessment).toEqual({ enabled: true, passingScorePercentage: 80, maxAttempts: null });
    expect(draft.input.slides[0]).toMatchObject({
      options: [
        { text: 'Bun', isCorrect: false },
        { text: 'Node', isCorrect: true },
        { text: 'Deno', isCorrect: false },
      ],
      points: 3,
      scoreDependsOnTime: false,
      config: { allowMultiple: false, explanation: 'Node is the classic.' },
    });
    expect(draft.input.slides[1]).toMatchObject({
      options: [
        { text: 'Bun', isCorrect: true },
        { text: 'Node', isCorrect: false },
        { text: 'Deno', isCorrect: true },
      ],
      points: 2,
      config: { allowMultiple: true, explanation: '' },
    });
  });

  it('clips text to the deck limits so the copy stays editable', () => {
    const draft = pollToDeckDraft({
      title: 'T'.repeat(300),
      pollType: 'POLL',
      passingScorePercentage: 70,
      questions: [question({ text: 'Q'.repeat(900), options: ['o'.repeat(400), 'b'] })],
    });
    expect(draft.input.title).toHaveLength(120);
    expect(draft.input.slides[0]!.question).toHaveLength(500);
    expect(draft.input.slides[0]!.options![0]!.text).toHaveLength(200);
  });

  it('refuses polls a deck cannot hold, naming the question', () => {
    const tooMany = conversionError(() =>
      pollToDeckDraft({
        title: 'Big',
        pollType: 'POLL',
        passingScorePercentage: 70,
        questions: [question(), question({ options: Array.from({ length: 9 }, (_, i) => `Option ${i}`) })],
      }),
    );
    expect(tooMany).toBeInstanceOf(ApiError);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.code).toBe('POLL_NOT_CONVERTIBLE');
    expect(tooMany.message).toContain('question 2:');

    // A TRIAL draft whose answers are not marked yet cannot be graded as a deck either.
    const unmarked = conversionError(() =>
      pollToDeckDraft({ title: 'Draft', pollType: 'TRIAL', passingScorePercentage: 70, questions: [question()] }),
    );
    expect(unmarked.message).toContain('question 1: Mark at least one option as correct');
  });
});
