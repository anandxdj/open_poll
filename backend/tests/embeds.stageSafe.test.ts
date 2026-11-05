import { describe, expect, it } from 'bun:test';
import { createPresentationSchema } from '../src/modules/presentations/presentations.schema';
import { listSlideTypes, requireSlideType } from '../src/modules/presentations/slides';
import { isRevealed, stageSafeSlide, stripAnswerKeys } from '../src/modules/embeds/stageSafe';

/**
 * Screens (W4-D) can sit on public pages, so their stage must never carry an
 * answer key before the reveal, nor speaker notes ever. Every registered
 * response type has a fixture here with its key set to a recognisable value;
 * a new type fails "covers every response type" until it gets one.
 */

const parsed = (slide: Record<string, unknown>): any => {
  const result = createPresentationSchema.safeParse({ title: 'T', slides: [slide] });
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return { ...result.data.slides[0]!, _id: 'slide-1' };
};

const NOTES = 'SPEAKER-NOTES-SECRET';

/** Fixture, raw counters for its distribution, and strings that must not reach a screen before the reveal. */
const FIXTURES: Record<string, { slide: Record<string, unknown>; raw: Record<string, string>; secrets: string[] }> = {
  select_answer: {
    slide: {
      type: 'select_answer',
      question: 'Pick',
      options: [
        { text: 'A', isCorrect: false },
        { text: 'B', isCorrect: true },
      ],
      config: { allowMultiple: true, explanation: 'EXPLANATION-SECRET' },
    },
    raw: { '0': '2', '1': '5' },
    secrets: ['"isCorrect":true', 'EXPLANATION-SECRET'],
  },
  type_answer: {
    slide: { type: 'type_answer', question: 'Capital?', acceptedAnswers: ['PARISSECRET'] },
    raw: { parissecret: '3', lyon: '1' },
    secrets: ['PARISSECRET', '"isCorrect":true'],
  },
  guess_number: {
    slide: { type: 'guess_number', question: 'Moons?', config: { min: 0, max: 100, step: 1, correct: 79, tolerance: 3 } },
    raw: { 'v:79': '2', 'v:10': '1' },
    secrets: ['"correct":79', '"tolerance":3', '"correctCount":2'],
  },
  pin_on_image: {
    slide: {
      type: 'pin_on_image',
      question: 'Paris?',
      timeLimit: 20,
      content: { url: 'https://img.example/map.png', alt: 'Map' },
      config: { region: { x: 0.4321, y: 0.2, width: 0.2, height: 0.2 } },
    },
    raw: { count: '2', inRegion: '1', 'h:4:2': '1' },
    secrets: ['0.4321', '"inRegion":1'],
  },
  hundred_points: {
    slide: { type: 'hundred_points', question: 'Invest', timeLimit: 0, config: { items: ['Docs', 'Tests'] } },
    raw: {},
    secrets: [],
  },
  grid_2x2: {
    slide: {
      type: 'grid_2x2',
      question: 'Rate',
      timeLimit: 0,
      config: { items: ['Dark mode'], x: { label: 'Effort', min: 0, max: 10 }, y: { label: 'Impact', min: 0, max: 10 } },
    },
    raw: {},
    secrets: [],
  },
  scales: { slide: { type: 'scales', question: 'Rate', statements: ['Fast'] }, raw: {}, secrets: [] },
  ranking: { slide: { type: 'ranking', question: 'Order', items: ['A', 'B'] }, raw: {}, secrets: [] },
  wordcloud: { slide: { type: 'wordcloud', question: 'Words', timeLimit: 0 }, raw: { hi: '2' }, secrets: [] },
  open_ended: { slide: { type: 'open_ended', question: 'Say', timeLimit: 0 }, raw: { hi: '1' }, secrets: [] },
};

const responseTypes = () => listSlideTypes().filter((def) => def.lifecycle === 'response').map((def) => def.type).sort();

describe('stage-safe slides (W4-D)', () => {
  it('covers every response type', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(responseTypes());
  });

  for (const [type, fixture] of Object.entries(FIXTURES)) {
    it(`${type}: no notes and no answer key before the reveal, all of it after`, () => {
      const slide = parsed({ ...fixture.slide, notes: NOTES });
      const before = JSON.stringify(stageSafeSlide(slide, false));
      expect(before).not.toContain(NOTES);
      for (const secret of fixture.secrets.filter((s) => !s.startsWith('"correctCount') && !s.startsWith('"inRegion'))) {
        expect(before).not.toContain(secret);
      }
      // Still the same slide: id, type, question and timing stay.
      const safe = stageSafeSlide(slide, false) as any;
      expect(safe._id).toBe('slide-1');
      expect(safe.type).toBe(type);
      expect(safe.question).toBe(slide.question);
      expect(safe.timeLimit).toBe(slide.timeLimit);

      const after = stageSafeSlide(slide, true) as any;
      expect(JSON.stringify(after)).not.toContain(NOTES);
      expect({ ...after, notes: NOTES }).toEqual(slide);
    });

    it(`${type}: the live distribution keeps its counts but not its key`, () => {
      const slide = parsed(fixture.slide);
      const def = requireSlideType(type);
      const distribution = def.distribution!(slide, { dist: fixture.raw, disp: {}, feed: [] });
      const stripped = JSON.stringify(stripAnswerKeys(distribution));
      for (const secret of fixture.secrets) expect(stripped).not.toContain(secret);
      // Nothing but key fields changed.
      expect(stripAnswerKeys(stripAnswerKeys(distribution))).toEqual(stripAnswerKeys(distribution));
      expect(stripAnswerKeys(distribution).kind).toEqual(distribution.kind);
    });
  }

  it('keeps what the stage needs to draw a slide before the reveal', () => {
    const select = stageSafeSlide(parsed(FIXTURES.select_answer!.slide), false) as any;
    expect(select.options).toEqual([
      { text: 'A', isCorrect: false },
      { text: 'B', isCorrect: false },
    ]);
    expect(select.config).toEqual({ allowMultiple: true });

    const guess = stageSafeSlide(parsed(FIXTURES.guess_number!.slide), false) as any;
    expect(guess.config).toEqual({ min: 0, max: 100, step: 1 });

    const pin = stageSafeSlide(parsed(FIXTURES.pin_on_image!.slide), false) as any;
    expect(pin.content).toEqual({ url: 'https://img.example/map.png', alt: 'Map' });
    expect(pin.config).toBeNull();

    const counts = stripAnswerKeys(
      requireSlideType('select_answer').distribution!(parsed(FIXTURES.select_answer!.slide), {
        dist: { '0': '2', '1': '5' },
        disp: {},
        feed: [],
      }),
    );
    expect(counts).toEqual({
      kind: 'options',
      counts: [2, 5],
      options: [
        { text: 'A', isCorrect: false },
        { text: 'B', isCorrect: false },
      ],
    });
  });

  it('leaves content slides alone except for their notes', () => {
    const heading = parsed({ type: 'heading', content: { title: 'Hello' }, notes: NOTES });
    expect(stageSafeSlide(heading, false)).toEqual({ ...heading, notes: '' });
  });

  it('reads the reveal from the slide state', () => {
    expect(isRevealed(null)).toBe(false);
    expect(isRevealed({ revealedAt: null })).toBe(false);
    expect(isRevealed({ revealedAt: new Date() })).toBe(true);
  });

  it('strips nested and repeated key fields, and leaves scalars and arrays of scalars alone', () => {
    expect(stripAnswerKeys<unknown>({ a: [{ isCorrect: true, b: { correct: 3 } }], acceptedAnswers: ["x"], n: 1 })).toEqual({
      a: [{ isCorrect: false, b: { correct: null } }],
      acceptedAnswers: [],
      n: 1,
    });
    expect(stripAnswerKeys(5)).toBe(5);
    expect(stripAnswerKeys(['a', 1])).toEqual(['a', 1]);
    expect(stripAnswerKeys(null)).toBeNull();
  });
});
