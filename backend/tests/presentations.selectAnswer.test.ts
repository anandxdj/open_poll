import { describe, expect, it } from 'bun:test';
import { ApiError } from '../src/common/utils/ApiError';
import { PresentationModel } from '../src/modules/presentations/presentations.model';
import { createPresentationSchema } from '../src/modules/presentations/presentations.schema';
import { requireSlideType, toParticipantSlide } from '../src/modules/presentations/slides';

/**
 * select_answer additions used by converted polls: `config.allowMultiple`,
 * `config.explanation`, and ungraded (0-point) slides without a correct option.
 * The single-select behaviour is pinned by tests/presentations/registry.golden.test.ts.
 */

const def = requireSlideType('select_answer');

const slide = (data: Record<string, unknown>) =>
  new PresentationModel({ title: 't', creatorId: 'c', joinCode: '1', slides: [{ type: 'select_answer', question: 'Pick', ...data }] })
    .slides[0]!;

const OPTIONS = [
  { text: 'A', isCorrect: true },
  { text: 'B', isCorrect: false },
  { text: 'C', isCorrect: true },
];

const parseSlide = (data: Record<string, unknown>) =>
  createPresentationSchema.safeParse({ title: 'T', slides: [{ type: 'select_answer', question: 'Q', ...data }] });

const rejection = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).message;
  }
  throw new Error('expected a rejection');
};

describe('select_answer request schema', () => {
  it('keeps config, defaulting its fields, and null when absent', () => {
    const withConfig = parseSlide({ options: OPTIONS, config: { allowMultiple: true } });
    expect(withConfig.success && withConfig.data.slides[0]!.config).toEqual({ allowMultiple: true, explanation: '' });
    const without = parseSlide({ options: OPTIONS });
    expect(without.success && without.data.slides[0]!.config).toBeNull();
    expect(parseSlide({ options: OPTIONS, config: { explanation: 'x'.repeat(2001) } }).success).toBe(false);
  });

  it('lets an ungraded (0-point) slide have no correct option, but not a graded one', () => {
    const ungraded = [
      { text: 'A', isCorrect: false },
      { text: 'B', isCorrect: false },
    ];
    expect(parseSlide({ options: ungraded, points: 0 }).success).toBe(true);
    const graded = parseSlide({ options: ungraded });
    expect(graded.success).toBe(false);
    expect(graded.error?.issues.map((issue) => issue.message)).toEqual(['Mark at least one option as correct']);
  });
});

describe('select_answer multi-select', () => {
  const multi = slide({ options: OPTIONS, config: { allowMultiple: true, explanation: 'A and C' } });
  const cfg = def.acceptConfig!(multi) as Record<string, unknown>;

  it('tells participants they may pick several, and never sends the explanation', () => {
    const participant = toParticipantSlide(multi, 0, 1);
    expect(participant).toMatchObject({ allowMultiple: true, options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }] });
    expect(JSON.stringify(participant)).not.toContain('A and C');
    expect(JSON.stringify(participant)).not.toContain('isCorrect');
    // Single-select slides keep the legacy participant shape exactly.
    expect(toParticipantSlide(slide({ options: OPTIONS }), 0, 1)).not.toHaveProperty('allowMultiple');
    expect(def.acceptConfig!(slide({ options: OPTIONS }))).not.toHaveProperty('allowMultiple');
  });

  it('grades the exact set of correct options and counts every pick', () => {
    const right = def.accept!(cfg, { optionIndices: [2, 0] }, { elapsedMs: 0 });
    expect(right.isCorrect).toBe(true);
    expect(right.ops).toEqual([
      { op: 'hincrby', key: 'dist', field: '0', by: 1 },
      { op: 'hincrby', key: 'dist', field: '2', by: 1 },
    ]);
    expect(right.persist).toEqual({ optionIndex: null, text: null, payload: { optionIndices: [0, 2] } });

    expect(def.accept!(cfg, { optionIndices: [0] }, { elapsedMs: 0 }).isCorrect).toBe(false);
    expect(def.accept!(cfg, { optionIndices: [0, 1, 2] }, { elapsedMs: 0 }).isCorrect).toBe(false);
    // A legacy single optionIndex is one pick.
    expect(def.accept!(cfg, { optionIndex: 1 }, { elapsedMs: 0 }).persist.payload).toEqual({ optionIndices: [1] });
  });

  it('rejects empty, duplicate and out-of-range picks', () => {
    for (const payload of [{}, { optionIndices: [] }, { optionIndices: [1, 1] }, { optionIndices: [0, 3] }, { optionIndices: [-1] }]) {
      expect(rejection(() => def.accept!(cfg, payload, { elapsedMs: 0 }))).toBe('Invalid options for this slide');
    }
  });

  it('treats an ungraded slide as never correct and worth nothing', () => {
    const survey = slide({ options: [{ text: 'A' }, { text: 'B' }], points: 0, config: { allowMultiple: true } });
    const surveyCfg = def.acceptConfig!(survey);
    const answer = def.accept!(surveyCfg, { optionIndices: [0, 1] }, { elapsedMs: 0 });
    expect(answer.isCorrect).toBe(false);
    expect(def.score!(surveyCfg, { isCorrect: true, elapsedMs: 0 })).toBe(0);
  });

  it('exports all picks in one cell', () => {
    expect(def.exportCells!(multi, { payload: { optionIndices: [0, 2] }, isCorrect: true, score: 1 })).toEqual(['A, C']);
    expect(def.exportCells!(multi, { optionIndex: 1, isCorrect: false, score: 0 })).toEqual(['B']);
    expect(def.exportCells!(multi, null)).toEqual([null]);
  });
});
