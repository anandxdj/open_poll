import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { DisabledStorage, setStorageDriver, type StorageDriver } from '../../src/common/storage/storage';
import { MediaAssetModel } from '../../src/modules/uploads/media.model';
import { PresentationService } from '../../src/modules/presentations/presentations.service';
import { createPresentationSchema } from '../../src/modules/presentations/presentations.schema';
import {
  isSlideScored,
  replayDistribution,
  requireSlideType,
  toParticipantSlide,
  type RedisOp,
} from '../../src/modules/presentations/slides';
import { assertContentMediaInWorkspace } from '../../src/modules/presentations/slides/types/content/media';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, sessionKey, type FakeRedis } from './harness';

/**
 * The four advanced interactive types (W2-E): guess_number, hundred_points,
 * grid_2x2 and pin_on_image. Golden-style: request schemas (defaults, limits,
 * messages), the participant allow-list (answer keys and notes never leak),
 * answer validation (malformed payloads rejected), the exact RedisOps each
 * answer produces, distributions, scoring and exports — then all four run
 * live through the facade on the in-memory Redis and model fakes.
 */

const ADVANCED_TYPES = ['grid_2x2', 'guess_number', 'hundred_points', 'pin_on_image'] as const;

const CDN = 'https://cdn.example/media';
const IMAGE_KEY = 'uploads/64b0000000000000000000a1/slide_image/202610/7d6c1f9e-4f0b-4d6c-9a43-3f4f1f0c2b11.png';
const MAP_URL = 'https://img.example/france.png';

const enabledStorage = (): StorageDriver => ({
  enabled: true,
  presignPut: async () => {
    throw new Error('unused');
  },
  publicUrl: (key) => `${CDN}/${key}`,
  stat: async () => null,
  getObject: async () => {
    throw new Error('unused');
  },
  putObject: async () => {},
  delete: async () => {},
});

const withStorage = <T>(driver: StorageDriver, run: () => T): T => {
  const previous = setStorageDriver(driver);
  try {
    return run();
  } finally {
    setStorageDriver(previous);
  }
};

const parse = (slide: Record<string, unknown>) => createPresentationSchema.safeParse({ title: 'T', slides: [slide] });

const parsed = (slide: Record<string, unknown>): any => {
  const result = parse(slide);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data.slides[0]!;
};

/** `[path, message]` of every issue, path relative to the slide. */
const issues = (slide: Record<string, unknown>) => {
  const result = parse(slide);
  expect(result.success).toBe(false);
  return result.error!.issues.map((issue) => [issue.path.slice(2).join('.'), issue.message]);
};

const wire = <T>(value: T): any => JSON.parse(JSON.stringify(value));

/** Grades `payload` for a stored slide the way the answer path does (answerSchema, then accept). */
const grade = (slide: any, payload: Record<string, unknown>, elapsedMs = 0) => {
  const def = requireSlideType(slide.type);
  const cfg = def.acceptConfig!(slide);
  const checked = def.answerSchema!.safeParse(payload);
  if (!checked.success) {
    throw new Error(checked.error.issues.map((i) => `${['payload', ...i.path].join('.')}: ${i.message}`).join('; '));
  }
  return def.accept!(cfg, checked.data, { elapsedMs });
};

/** The rejection message for `payload`, or a failure when it is accepted. */
const rejection = (slide: any, payload: Record<string, unknown>) => {
  try {
    grade(slide, payload);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`accepted ${JSON.stringify(payload)}`);
};

const scoreOf = (slide: any, isCorrect: boolean, elapsedMs: number) => {
  const def = requireSlideType(slide.type);
  return def.score!(def.acceptConfig!(slide), { isCorrect, elapsedMs });
};

/** Distribution rebuilt from answer payloads (oldest first) by replaying each answer's ops. */
const distributionOf = (slide: any, payloads: Record<string, unknown>[]) =>
  replayDistribution(
    slide,
    payloads.map((payload) => ({ payload }))
  );

const participantSlide = (slide: any) => wire(toParticipantSlide(slide, 0, 1));

// ---------------------------------------------------------------------------
// Fixtures: one valid slide of each type
// ---------------------------------------------------------------------------

const GUESS = {
  type: 'guess_number',
  question: 'How many moons does Jupiter have?',
  timeLimit: 30,
  points: 1000,
  config: { min: 0, max: 100, step: 1, correct: 79, tolerance: 3 },
};

const POINTS = {
  type: 'hundred_points',
  question: 'Where should we invest?',
  timeLimit: 0,
  config: { items: ['Docs', 'Tests', 'Speed'] },
};

const GRID = {
  type: 'grid_2x2',
  question: 'Rate the ideas',
  timeLimit: 0,
  config: {
    items: ['Dark mode', 'Offline'],
    x: { label: 'Effort', min: 0, max: 10 },
    y: { label: 'Impact', min: 0, max: 10 },
  },
};

const PIN = {
  type: 'pin_on_image',
  question: 'Where is Paris?',
  timeLimit: 20,
  points: 500,
  scoreDependsOnTime: false,
  content: { url: MAP_URL, alt: 'Map of France' },
  config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } },
};

// ---------------------------------------------------------------------------

describe('advanced slide registry entries', () => {
  it('registers the four types as interactive response slides with an answer path', () => {
    const summary = ADVANCED_TYPES.map((type) => {
      const def = requireSlideType(type);
      return {
        type,
        kind: def.kind,
        lifecycle: def.lifecycle,
        scored: def.scored,
        perSlide: typeof def.isScored === 'function',
        answers: Boolean(def.answerSchema && def.accept && def.acceptConfig && def.distribution),
        exports: Boolean(def.exportColumns && def.exportCells),
        feedLength: def.feedLength ?? null,
      };
    });
    expect(summary).toEqual([
      { type: 'grid_2x2', kind: 'interactive', lifecycle: 'response', scored: false, perSlide: false, answers: true, exports: true, feedLength: null },
      { type: 'guess_number', kind: 'interactive', lifecycle: 'response', scored: true, perSlide: true, answers: true, exports: true, feedLength: null },
      { type: 'hundred_points', kind: 'interactive', lifecycle: 'response', scored: false, perSlide: false, answers: true, exports: true, feedLength: null },
      { type: 'pin_on_image', kind: 'interactive', lifecycle: 'response', scored: true, perSlide: true, answers: true, exports: true, feedLength: 500 },
    ]);
  });

  it('labels slides by question, else the type name', () => {
    expect(requireSlideType('guess_number').label(parsed(GUESS))).toBe(GUESS.question);
    expect(requireSlideType('guess_number').label({ ...parsed(GUESS), question: '' })).toBe('Guess the number');
    expect(requireSlideType('hundred_points').label({ ...parsed(POINTS), question: ' ' })).toBe('100 points');
    expect(requireSlideType('grid_2x2').label({ ...parsed(GRID), question: '' })).toBe('2x2 grid');
    expect(requireSlideType('pin_on_image').label({ ...parsed(PIN), question: '' })).toBe('Pin on image');
  });
});

// ---------------------------------------------------------------------------
// guess_number
// ---------------------------------------------------------------------------

describe('guess_number', () => {
  it('defaults to 0–100 in steps of 1 with no correct value, and trims the question', () => {
    expect(parsed({ type: 'guess_number', question: '  Guess  ' })).toEqual({
      type: 'guess_number',
      question: 'Guess',
      notes: '',
      media: null,
      layout: null,
      timeLimit: 30,
      points: 1000,
      scoreDependsOnTime: true,
      config: { min: 0, max: 100, step: 1, correct: null, tolerance: 0 },
    });
  });

  it('allows an untimed slide only while it is ungraded', () => {
    expect(parsed({ ...GUESS, timeLimit: 0, config: { ...GUESS.config, correct: null } }).timeLimit).toBe(0);
    expect(parsed({ ...GUESS, timeLimit: 0, points: 0 }).timeLimit).toBe(0);
    expect(issues({ ...GUESS, timeLimit: 0 })).toEqual([
      ['timeLimit', 'Scored slides need a timer of at least 5 seconds'],
    ]);
    expect(issues({ ...GUESS, timeLimit: 3 })).toEqual([['timeLimit', 'Use 0 for an untimed slide or at least 5 seconds']]);
  });

  it('rejects inconsistent ranges, steps and correct values', () => {
    const withConfig = (config: Record<string, unknown>) => issues({ ...GUESS, config: { ...GUESS.config, ...config } });
    expect(withConfig({ min: 10, max: 10, correct: null })).toEqual([['config.max', 'Max must be greater than min']]);
    expect(withConfig({ step: 0 })).toEqual([['config.step', 'Step must be greater than 0']]);
    expect(withConfig({ step: 101 })).toEqual([['config.step', 'Step must fit between min and max']]);
    expect(withConfig({ max: 1_000_000_000, step: 0.5, correct: null })).toEqual([
      ['config.step', 'Use a larger step: at most 1,000,000 steps between min and max'],
    ]);
    expect(withConfig({ correct: 101 })).toEqual([['config.correct', 'The correct value must be between min and max']]);
    expect(withConfig({ step: 5, correct: 79 })).toEqual([
      ['config.correct', 'The correct value must be on the slider steps'],
    ]);
    expect(withConfig({ max: 1, step: 0.00001, correct: null })).toEqual([['config.step', 'Use at most 4 decimal places']]);
    expect(withConfig({ min: -2_000_000_000 })[0]![0]).toBe('config.min');
    expect(withConfig({ tolerance: -1 })).toEqual([['config.tolerance', 'Tolerance cannot be negative']]);
    expect(withConfig({ min: 'zero' })[0]![0]).toBe('config.min');
  });

  it('sends participants the range only: never the correct value, tolerance or notes', () => {
    const slide = { ...parsed(GUESS), notes: 'Answer: 79 (NASA 2023)' };
    const shown = participantSlide(slide);
    expect(shown).toEqual({
      question: GUESS.question,
      timeLimit: 30,
      points: 1000,
      scoreDependsOnTime: true,
      config: { min: 0, max: 100, step: 1 },
      slideIndex: 0,
      totalSlides: 1,
      type: 'guess_number',
      kind: 'interactive',
      scored: true,
      media: null,
      layout: null,
    });
    const json = JSON.stringify(shown);
    for (const leak of ['79', 'correct', 'tolerance', 'NASA']) expect(json).not.toContain(leak);
  });

  it('is graded only when worth points and given a correct value', () => {
    expect(isSlideScored(parsed(GUESS))).toBe(true);
    expect(isSlideScored(parsed({ ...GUESS, points: 0 }))).toBe(false);
    expect(isSlideScored(parsed({ ...GUESS, config: { ...GUESS.config, correct: null } }))).toBe(false);
    expect(participantSlide(parsed({ ...GUESS, points: 0 })).scored).toBe(false);
  });

  it('rejects missing, out-of-range, off-step and non-numeric guesses', () => {
    const slide = parsed(GUESS);
    expect(rejection(slide, {})).toBe('Enter your guess');
    expect(rejection(slide, { value: -1 })).toBe('Your guess must be between 0 and 100');
    expect(rejection(slide, { value: 100.5 })).toBe('Your guess must be between 0 and 100');
    expect(rejection(slide, { value: 2.5 })).toBe('Your guess must be 0 plus a multiple of 1');
    expect(rejection(slide, { value: '50' })).toStartWith('payload.value: ');
    expect(rejection(slide, { value: Number.POSITIVE_INFINITY })).toStartWith('payload.value: ');
  });

  it('counts each guess in one hincrby and grades it against correct ± tolerance', () => {
    const slide = parsed(GUESS);
    expect(grade(slide, { value: 50 })).toEqual({
      isCorrect: false,
      ops: [{ op: 'hincrby', key: 'dist', field: 'v:50', by: 1 }],
      persist: { optionIndex: null, text: null, payload: { value: 50 } },
    });
    expect([75, 76, 79, 82, 83].map((value) => grade(slide, { value }).isCorrect)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('snaps float noise to the slider steps', () => {
    const slide = parsed({ ...GUESS, config: { min: 0, max: 1, step: 0.1, correct: 0.3, tolerance: 0 } });
    const graded = grade(slide, { value: 0.1 + 0.2 });
    expect(graded.ops).toEqual([{ op: 'hincrby', key: 'dist', field: 'v:0.3', by: 1 }]);
    expect(graded.persist.payload).toEqual({ value: 0.3 });
    expect(graded.isCorrect).toBe(true);
  });

  it('scores correct guesses with the speed bonus, like select_answer', () => {
    const slide = parsed(GUESS);
    expect(scoreOf(slide, true, 0)).toBe(1000);
    expect(scoreOf(slide, true, 15_000)).toBe(750);
    expect(scoreOf(slide, false, 0)).toBe(0);
    expect(scoreOf({ ...slide, scoreDependsOnTime: false }, true, 29_000)).toBe(1000);
  });

  it('distributes guesses into a histogram with count, mean, median and the correct count', () => {
    const slide = parsed(GUESS);
    const dist = distributionOf(slide, [10, 20, 20, 79, 80, 100].map((value) => ({ value })));
    expect(dist).toEqual({
      kind: 'guess_number',
      min: 0,
      max: 100,
      step: 1,
      count: 6,
      mean: 51.5,
      median: 49.5,
      buckets: [
        { from: 0, to: 10, count: 1 },
        { from: 11, to: 21, count: 2 },
        { from: 22, to: 32, count: 0 },
        { from: 33, to: 43, count: 0 },
        { from: 44, to: 54, count: 0 },
        { from: 55, to: 65, count: 0 },
        { from: 66, to: 76, count: 0 },
        { from: 77, to: 87, count: 2 },
        { from: 88, to: 98, count: 0 },
        { from: 99, to: 100, count: 1 },
      ],
      correct: 79,
      tolerance: 3,
      correctCount: 2,
    });
  });

  it('draws one bar per value for small ranges and has empty stats without answers', () => {
    const slide = parsed({ ...GUESS, config: { min: 1, max: 5, step: 1, correct: null } });
    expect(distributionOf(slide, [{ value: 2 }, { value: 4 }, { value: 5 }])).toMatchObject({
      count: 3,
      mean: 3.67,
      median: 4,
      buckets: [1, 2, 3, 4, 5].map((v) => ({ from: v, to: v, count: v === 1 || v === 3 ? 0 : 1 })),
      correct: null,
      correctCount: null,
    });
    expect(distributionOf(slide, [])).toMatchObject({ count: 0, mean: null, median: null });
  });

  it('exports the guess', () => {
    const def = requireSlideType('guess_number');
    const slide = parsed(GUESS);
    expect(def.exportColumns!(slide)).toEqual([GUESS.question]);
    expect(def.exportCells!(slide, { payload: { value: 42 }, isCorrect: false, score: 0 })).toEqual([42]);
    expect(def.exportCells!(slide, null)).toEqual([null]);
  });
});

// ---------------------------------------------------------------------------
// hundred_points
// ---------------------------------------------------------------------------

describe('hundred_points', () => {
  it('needs 2–10 non-empty items and never stores points', () => {
    expect(parsed({ ...POINTS, points: 900, scoreDependsOnTime: true, config: { items: [' A ', 'B'] } })).toEqual({
      type: 'hundred_points',
      question: POINTS.question,
      notes: '',
      media: null,
      layout: null,
      timeLimit: 0,
      points: 0,
      scoreDependsOnTime: false,
      config: { items: ['A', 'B'] },
    });
    expect(issues({ ...POINTS, config: { items: ['Only'] } })).toEqual([
      ['config.items', 'Hundred points slides need at least 2 items'],
    ]);
    expect(issues({ type: 'hundred_points', question: 'Q' })).toEqual([
      ['config.items', 'Hundred points slides need at least 2 items'],
    ]);
    expect(issues({ ...POINTS, config: { items: Array.from({ length: 11 }, (_, i) => `I${i}`) } })).toEqual([
      ['config.items', 'Hundred points slides take at most 10 items'],
    ]);
    expect(issues({ ...POINTS, config: { items: ['A', '  '] } })).toEqual([['config.items.1', 'Item text is required']]);
    expect(issues({ ...POINTS, question: '' })).toEqual([['question', 'Question text is required']]);
  });

  it('sends participants the items only', () => {
    const shown = participantSlide({ ...parsed(POINTS), notes: 'secret plan' });
    expect(shown).toEqual({
      question: POINTS.question,
      timeLimit: 0,
      config: { items: ['Docs', 'Tests', 'Speed'] },
      slideIndex: 0,
      totalSlides: 1,
      type: 'hundred_points',
      kind: 'interactive',
      scored: false,
      media: null,
      layout: null,
    });
  });

  it('rejects a sum other than 100, wrong lengths, negatives and fractions', () => {
    const slide = parsed(POINTS);
    expect(rejection(slide, { points: [50, 49, 0] })).toBe('Points must add up to 100 (you gave 99)');
    expect(rejection(slide, { points: [50, 51, 0] })).toBe('Points must add up to 100 (you gave 101)');
    expect(rejection(slide, { points: [50, 50] })).toBe('Give points to each of the 3 items');
    expect(rejection(slide, { points: [50, 50, 0, 0] })).toBe('Give points to each of the 3 items');
    expect(rejection(slide, {})).toBe('Give points to each of the 3 items');
    expect(rejection(slide, { points: [-10, 110, 0] })).toBe('Points cannot be negative');
    expect(rejection(slide, { points: [33.5, 33.5, 33] })).toBe('Points must be whole numbers');
    expect(rejection(slide, { points: ['100', 0, 0] })).toStartWith('payload.points.0: ');
    expect(rejection(slide, { points: Array.from({ length: 11 }, () => 0) })).toStartWith('payload.points: ');
  });

  it('adds each non-zero share to its item and counts the voter', () => {
    expect(grade(parsed(POINTS), { points: [60, 40, 0] })).toEqual({
      isCorrect: false,
      ops: [
        { op: 'hincrby', key: 'dist', field: 'i:0', by: 60 },
        { op: 'hincrby', key: 'dist', field: 'i:1', by: 40 },
        { op: 'hincrby', key: 'dist', field: 'voters', by: 1 },
      ],
      persist: { optionIndex: null, text: null, payload: { points: [60, 40, 0] } },
    });
  });

  it('distributes total and average points per item, in authored order', () => {
    const dist = distributionOf(parsed(POINTS), [{ points: [60, 40, 0] }, { points: [20, 30, 50] }, { points: [0, 0, 100] }]);
    expect(dist).toEqual({
      kind: 'hundred_points',
      items: [
        { text: 'Docs', total: 80, average: 26.7 },
        { text: 'Tests', total: 70, average: 23.3 },
        { text: 'Speed', total: 150, average: 50 },
      ],
      voters: 3,
    });
  });

  it('exports one column per item', () => {
    const def = requireSlideType('hundred_points');
    const slide = parsed(POINTS);
    expect(def.exportColumns!(slide)).toEqual([
      'Where should we invest? — Docs',
      'Where should we invest? — Tests',
      'Where should we invest? — Speed',
    ]);
    expect(def.exportCells!(slide, { payload: { points: [60, 40, 0] }, isCorrect: false, score: 0 })).toEqual([60, 40, 0]);
    expect(def.exportCells!(slide, null)).toEqual([null, null, null]);
  });
});

// ---------------------------------------------------------------------------
// grid_2x2
// ---------------------------------------------------------------------------

describe('grid_2x2', () => {
  it('needs 1–10 items and two labelled axes with integer bounds', () => {
    expect(parsed({ ...GRID, config: { items: ['A'], x: { label: ' Effort ' }, y: { label: 'Impact', min: -5, max: 5 } } }).config).toEqual({
      items: ['A'],
      x: { label: 'Effort', min: 0, max: 10 },
      y: { label: 'Impact', min: -5, max: 5 },
    });
    expect(issues({ type: 'grid_2x2', question: 'Q' })).toEqual([
      ['config.items', '2x2 grid slides need at least 1 item'],
      ['config.x.label', 'Horizontal axis label is required'],
      ['config.y.label', 'Vertical axis label is required'],
    ]);
    expect(issues({ ...GRID, config: { ...GRID.config, x: { label: 'E', min: 5, max: 5 } } })).toEqual([
      ['config.x.max', 'Horizontal axis max must be greater than its min'],
    ]);
    expect(issues({ ...GRID, config: { ...GRID.config, y: { label: 'I', min: 0, max: 2.5 } } })[0]![0]).toBe('config.y.max');
    expect(issues({ ...GRID, config: { ...GRID.config, items: Array.from({ length: 11 }, (_, i) => `I${i}`) } })).toEqual([
      ['config.items', '2x2 grid slides take at most 10 items'],
    ]);
    expect(parsed({ ...GRID, points: 1000 }).points).toBe(0);
  });

  it('sends participants the items and axes only', () => {
    expect(participantSlide({ ...parsed(GRID), notes: 'n' })).toEqual({
      question: GRID.question,
      timeLimit: 0,
      config: GRID.config,
      slideIndex: 0,
      totalSlides: 1,
      type: 'grid_2x2',
      kind: 'interactive',
      scored: false,
      media: null,
      layout: null,
    });
  });

  it('rejects missing items and positions outside either axis', () => {
    const slide = parsed(GRID);
    expect(rejection(slide, { positions: [{ x: 1, y: 1 }] })).toBe('Place each of the 2 items');
    expect(rejection(slide, {})).toBe('Place each of the 2 items');
    expect(rejection(slide, { positions: [{ x: 11, y: 1 }, { x: 1, y: 1 }] })).toBe(
      'Horizontal positions must be between 0 and 10'
    );
    expect(rejection(slide, { positions: [{ x: 1, y: 1 }, { x: 1, y: -0.01 }] })).toBe(
      'Vertical positions must be between 0 and 10'
    );
    expect(rejection(slide, { positions: [{ x: 1 }, { x: 1, y: 1 }] })).toStartWith('payload.positions.0.y: ');
  });

  it('adds positions in hundredths per item and counts the voter', () => {
    expect(grade(parsed(GRID), { positions: [{ x: 2.5, y: 9 }, { x: 0, y: 10 }] })).toEqual({
      isCorrect: false,
      ops: [
        { op: 'hincrby', key: 'dist', field: 'i:0:x', by: 250 },
        { op: 'hincrby', key: 'dist', field: 'i:0:y', by: 900 },
        { op: 'hincrby', key: 'dist', field: 'i:0:n', by: 1 },
        { op: 'hincrby', key: 'dist', field: 'i:1:x', by: 0 },
        { op: 'hincrby', key: 'dist', field: 'i:1:y', by: 1000 },
        { op: 'hincrby', key: 'dist', field: 'i:1:n', by: 1 },
        { op: 'hincrby', key: 'dist', field: 'voters', by: 1 },
      ],
      persist: { optionIndex: null, text: null, payload: { positions: [{ x: 2.5, y: 9 }, { x: 0, y: 10 }] } },
    });
  });

  it('distributes the average position of each item, also on negative axes', () => {
    expect(
      distributionOf(parsed(GRID), [
        { positions: [{ x: 2, y: 8 }, { x: 9, y: 3 }] },
        { positions: [{ x: 3, y: 9 }, { x: 7.5, y: 2 }] },
      ])
    ).toEqual({
      kind: 'grid_2x2',
      x: GRID.config.x,
      y: GRID.config.y,
      items: [
        { text: 'Dark mode', x: 2.5, y: 8.5, count: 2 },
        { text: 'Offline', x: 8.25, y: 2.5, count: 2 },
      ],
      voters: 2,
    });
    const signed = parsed({ ...GRID, config: { ...GRID.config, items: ['A'], x: { label: 'L', min: -5, max: 5 } } });
    expect(distributionOf(signed, [{ positions: [{ x: -4.5, y: 1 }] }, { positions: [{ x: -1, y: 2 }] }])).toMatchObject({
      items: [{ text: 'A', x: -2.75, y: 1.5, count: 2 }],
    });
    expect(distributionOf(signed, [])).toMatchObject({ items: [{ text: 'A', x: null, y: null, count: 0 }], voters: 0 });
  });

  it('exports two columns per item', () => {
    const def = requireSlideType('grid_2x2');
    const slide = parsed(GRID);
    expect(def.exportColumns!(slide)).toEqual([
      'Rate the ideas — Dark mode (Effort)',
      'Rate the ideas — Dark mode (Impact)',
      'Rate the ideas — Offline (Effort)',
      'Rate the ideas — Offline (Impact)',
    ]);
    expect(
      def.exportCells!(slide, { payload: { positions: [{ x: 2, y: 8 }, { x: 9, y: 3 }] }, isCorrect: false, score: 0 })
    ).toEqual([2, 8, 9, 3]);
    expect(def.exportCells!(slide, null)).toEqual([null, null, null, null]);
  });
});

// ---------------------------------------------------------------------------
// pin_on_image
// ---------------------------------------------------------------------------

describe('pin_on_image', () => {
  it('stores the image like an image slide and the correct area in config', () => {
    expect(parsed(PIN)).toEqual({
      type: 'pin_on_image',
      question: PIN.question,
      notes: '',
      media: null,
      layout: null,
      timeLimit: 20,
      points: 500,
      scoreDependsOnTime: false,
      content: { key: null, url: MAP_URL, alt: 'Map of France' },
      config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } },
    });
    // No correct area: results only, may be untimed; no image yet: a draft placeholder.
    expect(parsed({ type: 'pin_on_image', question: 'Q', timeLimit: 0, content: { alt: 'A' } })).toMatchObject({
      content: { key: null, url: null, alt: 'A' },
      config: { region: null },
      timeLimit: 0,
    });
  });

  it('rejects unsafe image links, missing alt text and areas outside the image', () => {
    expect(issues({ ...PIN, content: { url: 'http://img.example/a.png', alt: 'A' } })).toEqual([
      ['content.url', 'Image URL must start with https://'],
    ]);
    expect(issues({ ...PIN, content: { url: 'javascript:alert(1)', alt: 'A' } })).toEqual([
      ['content.url', 'Image URL must start with https://'],
    ]);
    expect(issues({ ...PIN, content: { url: MAP_URL } })).toEqual([
      ['content.alt', 'Alt text is required: describe the image for people who cannot see it'],
    ]);
    const region = (r: Record<string, unknown>) => issues({ ...PIN, config: { region: r } });
    expect(region({ x: 0.9, y: 0.2, width: 0.2, height: 0.2 })).toEqual([
      ['config.region', 'The correct area must lie inside the image'],
    ]);
    expect(region({ x: 0.4, y: 0.2, width: 0.001, height: 0.2 })).toEqual([
      ['config.region.width', 'The correct area is too small'],
    ]);
    expect(region({ x: -0.1, y: 0.2, width: 0.2, height: 0.2 })[0]![0]).toBe('config.region.x');
    expect(issues({ ...PIN, timeLimit: 0 })).toEqual([['timeLimit', 'Scored slides need a timer of at least 5 seconds']]);
  });

  it('accepts uploads by key only with storage, pinning the URL to the storage object', () => {
    withStorage(new DisabledStorage(), () => {
      expect(issues({ ...PIN, content: { key: IMAGE_KEY, alt: 'A' } })).toEqual([
        ['content.key', 'File uploads are not configured on this server; use a link instead'],
      ]);
    });
    withStorage(enabledStorage(), () => {
      const slide = parsed({ ...PIN, content: { key: IMAGE_KEY, url: 'https://evil.example/x.png', alt: 'A' } });
      expect(slide.content).toEqual({ key: IMAGE_KEY, url: `${CDN}/${IMAGE_KEY}`, alt: 'A' });
      expect(issues({ ...PIN, content: { key: 'uploads/x/logo.svg', alt: 'A' } })).toEqual([
        ['content.key', 'Not an uploaded image'],
      ]);
    });
  });

  it('checks uploaded pin images against the workspace like image slides', async () => {
    const saved = MediaAssetModel.find;
    (MediaAssetModel as any).find = () => ({ select: () => ({ lean: async () => [] }) });
    try {
      const slides = [{ type: 'pin_on_image', content: { key: IMAGE_KEY, alt: 'A' } }];
      let error: any;
      try {
        await withStorage(enabledStorage(), () => assertContentMediaInWorkspace(slides, '64b0000000000000000000a1'));
      } catch (caught) {
        error = caught;
      }
      expect({ status: error?.statusCode, code: error?.code }).toEqual({ status: 400, code: 'MEDIA_NOT_FOUND' });
    } finally {
      (MediaAssetModel as any).find = saved;
    }
  });

  it('sends participants the image URL and alt text only: never the key, the correct area or notes', () => {
    const shown = participantSlide({ ...parsed(PIN), notes: 'Paris is near the top' });
    expect(shown).toEqual({
      question: PIN.question,
      timeLimit: 20,
      points: 500,
      scoreDependsOnTime: false,
      content: { url: MAP_URL, alt: 'Map of France' },
      slideIndex: 0,
      totalSlides: 1,
      type: 'pin_on_image',
      kind: 'interactive',
      scored: true,
      media: null,
      layout: null,
    });
    expect(JSON.stringify(shown)).not.toMatch(/region|0\.4|Paris is/);

    withStorage(enabledStorage(), () => {
      const uploaded = participantSlide(parsed({ ...PIN, content: { key: IMAGE_KEY, alt: 'A' } }));
      expect(uploaded.content).toEqual({ url: `${CDN}/${IMAGE_KEY}`, alt: 'A' });
      expect(JSON.stringify(uploaded)).not.toContain('"key"');
    });
  });

  it('is graded only when worth points and given a correct area', () => {
    expect(isSlideScored(parsed(PIN))).toBe(true);
    expect(isSlideScored(parsed({ ...PIN, points: 0 }))).toBe(false);
    expect(isSlideScored(parsed({ ...PIN, config: { region: null } }))).toBe(false);
  });

  it('rejects pins outside [0,1] and missing coordinates', () => {
    const slide = parsed(PIN);
    for (const payload of [{ x: 1.01, y: 0.5 }, { x: -0.01, y: 0.5 }, { x: 0.5, y: 1.5 }, { x: 0.5, y: -1 }]) {
      expect(rejection(slide, payload)).toBe('Pin coordinates must be between 0 and 1');
    }
    expect(rejection(slide, { x: 0.5 })).toBe('Drop a pin on the image');
    expect(rejection(slide, {})).toBe('Drop a pin on the image');
    expect(rejection(slide, { x: '0.5', y: 0.5 })).toStartWith('payload.x: ');
    expect(grade(slide, { x: 0, y: 1 }).isCorrect).toBe(false);
  });

  it('pushes the pin to the capped feed and counts it, in the area and in its heat cell', () => {
    const inside = grade(parsed(PIN), { x: 0.512345, y: 0.3 });
    expect(inside).toEqual({
      isCorrect: true,
      ops: [
        { op: 'lpush_trim', key: 'feed', value: '0.5123,0.3', max: 500 },
        { op: 'hincrby', key: 'dist', field: 'count', by: 1 },
        { op: 'hincrby', key: 'dist', field: 'h:10:6', by: 1 },
        { op: 'hincrby', key: 'dist', field: 'inRegion', by: 1 },
      ],
      persist: { optionIndex: null, text: null, payload: { x: 0.5123, y: 0.3 } },
    });
    const outside = grade(parsed(PIN), { x: 1, y: 1 });
    expect(outside.isCorrect).toBe(false);
    expect(outside.ops.map((op: RedisOp) => (op.op === 'hincrby' ? op.field : op.op))).toEqual([
      'lpush_trim',
      'count',
      'h:19:19',
    ]);
    // Region edges count as inside.
    expect(grade(parsed(PIN), { x: 0.6, y: 0.4 }).isCorrect).toBe(true);
    expect(grade(parsed({ ...PIN, config: { region: null } }), { x: 0.5, y: 0.3 }).ops).toHaveLength(3);
  });

  it('scores pins in the area (flat points here)', () => {
    expect(scoreOf(parsed(PIN), true, 19_000)).toBe(500);
    expect(scoreOf(parsed(PIN), false, 0)).toBe(0);
  });

  it('distributes the newest pins, a heatmap of all pins and the count in the area', () => {
    const dist = distributionOf(parsed(PIN), [
      { x: 0.5, y: 0.3 },
      { x: 0.51, y: 0.31 },
      { x: 0.9, y: 0.9 },
    ]);
    expect(dist).toEqual({
      kind: 'pin_on_image',
      count: 3,
      pins: [
        { x: 0.9, y: 0.9 },
        { x: 0.51, y: 0.31 },
        { x: 0.5, y: 0.3 },
      ],
      heat: {
        size: 20,
        cells: [
          { col: 10, row: 6, count: 2 },
          { col: 18, row: 18, count: 1 },
        ],
      },
      region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 },
      inRegion: 2,
    });
    expect(distributionOf(parsed({ ...PIN, config: { region: null } }), [{ x: 0.5, y: 0.5 }])).toMatchObject({
      region: null,
      inRegion: null,
    });
  });

  it('keeps only the newest 500 pins but counts every one', () => {
    const payloads = Array.from({ length: 510 }, (_, i) => ({ x: (i % 100) / 100, y: 0.5 }));
    const dist = distributionOf(parsed(PIN), payloads) as any;
    expect(dist.count).toBe(510);
    expect(dist.pins).toHaveLength(500);
    expect(dist.pins[0]).toEqual({ x: 0.09, y: 0.5 });
  });

  it('exports x and y', () => {
    const def = requireSlideType('pin_on_image');
    const slide = parsed(PIN);
    expect(def.exportColumns!(slide)).toEqual(['Where is Paris? — x', 'Where is Paris? — y']);
    expect(def.exportCells!(slide, { payload: { x: 0.5, y: 0.25 }, isCorrect: true, score: 500 })).toEqual([0.5, 0.25]);
    expect(def.exportCells!(slide, null)).toEqual([null, null]);
  });
});

// ---------------------------------------------------------------------------
// All four live through the facade (real answer path on the fakes)
// ---------------------------------------------------------------------------

describe('advanced deck, live', () => {
  const T0 = new Date('2026-10-19T09:00:00.000Z').getTime();
  const at = (ms: number) => setSystemTime(new Date(T0 + ms));
  let redis: FakeRedis;
  let restoreRedis: () => void;
  let models: ReturnType<typeof installModelStubs>;

  beforeEach(() => {
    const fake = installFakeRedis();
    redis = fake.redis;
    restoreRedis = fake.restore;
    models = installModelStubs();
    at(0);
  });

  afterEach(async () => {
    await flush();
    models.restore();
    restoreRedis();
    setSystemTime();
  });

  type Joined = Awaited<ReturnType<typeof PresentationService.joinPresentation>>;

  const answer = (pid: string, who: Joined, slideIndex: number, payload: Record<string, unknown>) =>
    PresentationService.submitAnswer(pid, {
      participantId: who.participantId,
      participantToken: who.token,
      slideIndex,
      payload,
    } as any);

  const rejected = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error: any) {
      return { status: error.statusCode, message: error.message };
    }
    throw new Error('expected a rejection');
  };

  it('runs all four types: sanitized slides out, malformed answers rejected, results and scores in', async () => {
    const slides = [GUESS, POINTS, GRID, PIN].map((s) => ({ ...parsed(s), notes: `notes ${s.type}` }));
    const deck = models.addPresentation({ title: 'Advanced', creatorId: OWNER_ID, joinCode: '515151', slides });
    expect(deck.validateSync()).toBeUndefined();
    const pid = String(deck._id);
    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await PresentationService.joinPresentation(pid, { name: 'Ada' });
    const linus = await PresentationService.joinPresentation(pid, { name: 'Linus' });
    const session = models.sessions.at(-1)!;
    const sid = String(session._id);
    const slideId = (i: number) => String(session.deckSnapshot[i]._id);
    const resultOf = (i: number, who: Joined) => {
      const { isCorrect, score, scored, payload } = JSON.parse(redis.hash(sessionKey(sid, 'results', slideId(i)))[who.participantId]!);
      return { isCorrect, score, scored, payload };
    };

    // ---- 0: guess_number (graded, speed scored) ----
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const started = redis.lastEvent('question:started')!.payload;
    expect(started.slide).toMatchObject({ type: 'guess_number', scored: true, config: { min: 0, max: 100, step: 1 } });
    expect(await rejected(answer(pid, ada, 0, { value: 101 }))).toEqual({
      status: 400,
      message: 'Your guess must be between 0 and 100',
    });
    // The dedup marker is rolled back: Ada can still answer.
    at(15_000);
    expect(await answer(pid, ada, 0, { value: 80 })).toMatchObject({ accepted: true });
    expect(await answer(pid, linus, 0, { value: 20 })).toMatchObject({ accepted: true });
    expect(await rejected(answer(pid, ada, 0, { value: 79 }))).toEqual({
      status: 409,
      message: 'You already responded to this slide',
    });
    expect(redis.hash(sessionKey(sid, 'dist', slideId(0)))).toEqual({ 'v:80': '1', 'v:20': '1' });
    expect(resultOf(0, ada)).toEqual({ isCorrect: true, score: 750, scored: true, payload: { value: 80 } });
    expect(resultOf(0, linus)).toEqual({ isCorrect: false, score: 0, scored: true, payload: { value: 20 } });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toMatchObject({
      kind: 'guess_number',
      count: 2,
      mean: 50,
      median: 50,
      correct: 79,
      correctCount: 1,
    });

    // ---- 1: hundred_points ----
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:started')!.payload.slide).toMatchObject({
      type: 'hundred_points',
      scored: false,
      config: { items: ['Docs', 'Tests', 'Speed'] },
    });
    expect(await rejected(answer(pid, ada, 1, { points: [50, 50, 1] }))).toEqual({
      status: 400,
      message: 'Points must add up to 100 (you gave 101)',
    });
    await answer(pid, ada, 1, { points: [50, 50, 0] });
    await answer(pid, linus, 1, { points: [10, 20, 70] });
    expect(resultOf(1, ada)).toEqual({ isCorrect: false, score: 0, scored: false, payload: { points: [50, 50, 0] } });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toEqual({
      kind: 'hundred_points',
      items: [
        { text: 'Docs', total: 60, average: 30 },
        { text: 'Tests', total: 70, average: 35 },
        { text: 'Speed', total: 70, average: 35 },
      ],
      voters: 2,
    });

    // ---- 2: grid_2x2 ----
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(await rejected(answer(pid, ada, 2, { positions: [{ x: 1, y: 1 }, { x: 1, y: 11 }] }))).toEqual({
      status: 400,
      message: 'Vertical positions must be between 0 and 10',
    });
    await answer(pid, ada, 2, { positions: [{ x: 2, y: 8 }, { x: 9, y: 3 }] });
    await answer(pid, linus, 2, { positions: [{ x: 4, y: 6 }, { x: 7, y: 1 }] });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toMatchObject({
      kind: 'grid_2x2',
      items: [
        { text: 'Dark mode', x: 3, y: 7, count: 2 },
        { text: 'Offline', x: 8, y: 2, count: 2 },
      ],
      voters: 2,
    });

    // ---- 3: pin_on_image (graded, flat points) ----
    at(60_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const pinSlide = redis.lastEvent('question:started')!.payload.slide;
    expect(pinSlide).toMatchObject({ type: 'pin_on_image', scored: true, content: { url: MAP_URL, alt: 'Map of France' } });
    expect(JSON.stringify(pinSlide)).not.toContain('region');
    expect(await rejected(answer(pid, ada, 3, { x: 1.2, y: 0.5 }))).toEqual({
      status: 400,
      message: 'Pin coordinates must be between 0 and 1',
    });
    at(65_000);
    await answer(pid, ada, 3, { x: 0.5, y: 0.3 });
    await answer(pid, linus, 3, { x: 0.1, y: 0.9 });
    expect(await redis.lRange(sessionKey(sid, 'feed', slideId(3)), 0, -1)).toEqual(['0.1,0.9', '0.5,0.3']);
    expect(resultOf(3, ada)).toMatchObject({ isCorrect: true, score: 500 });
    expect(resultOf(3, linus)).toMatchObject({ isCorrect: false, score: 0 });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toMatchObject({
      kind: 'pin_on_image',
      count: 2,
      pins: [
        { x: 0.1, y: 0.9 },
        { x: 0.5, y: 0.3 },
      ],
      inRegion: 1,
    });

    // Scores: Ada 750 (guess) + 500 (pin); Linus 0.
    expect(redis.zset(sessionKey(sid, 'scores'))).toEqual({ [ada.participantId]: 1250, [linus.participantId]: 0 });
    // Notes never went out on any event.
    expect(JSON.stringify(redis.published)).not.toContain('notes ');
    await PresentationService.endPresentation(pid, OWNER_ID);
  });
});
