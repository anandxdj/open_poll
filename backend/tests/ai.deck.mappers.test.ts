import { describe, expect, it } from 'bun:test';
import { getSlideType, listSlideTypes } from '../src/modules/presentations/slides';
import {
  availableKinds,
  cleanList,
  cleanText,
  DECK_SLIDE_MAPPERS,
  findMapper,
  NOTES_MAX,
  stripMarkdownLinks,
  toRegistrySlide,
} from '../src/modules/ai/deck/slideMappers';
import type { GeneratedSlide } from '../src/modules/ai/deck/deck.schema';
import { validGenerated } from './helpers/deckLlm';

const mapperOf = (kind: string) => DECK_SLIDE_MAPPERS.find((mapper) => mapper.kind === kind)!;
const mapOk = (kind: string, slide: GeneratedSlide) => {
  const result = toRegistrySlide(mapperOf(kind), slide);
  if (!result.ok) throw new Error(`${kind} did not validate: ${result.issues.join('; ')}`);
  return result.slide;
};

describe('deck kinds', () => {
  it('maps to registered types only', () => {
    for (const mapper of DECK_SLIDE_MAPPERS) expect(getSlideType(mapper.type)).toBeDefined();
    expect(new Set(DECK_SLIDE_MAPPERS.map((mapper) => mapper.kind)).size).toBe(DECK_SLIDE_MAPPERS.length);
  });

  it('offers a kind only while its registry type is registered', () => {
    const all = availableKinds().map((mapper) => mapper.kind);
    expect(all).toEqual(DECK_SLIDE_MAPPERS.map((mapper) => mapper.kind));
    const noWordcloud = availableKinds(undefined, (type) => type !== 'wordcloud').map((mapper) => mapper.kind);
    expect(noWordcloud).not.toContain('wordcloud');
    expect(noWordcloud).toContain('open_ended');
    expect(availableKinds(undefined, () => false)).toEqual([]);
  });

  it('follows the requested categories', () => {
    const kinds = (include: { content: boolean; polls: boolean; quiz: boolean }) => availableKinds(include).map((mapper) => mapper.category);
    expect(new Set(kinds({ content: true, polls: false, quiz: false }))).toEqual(new Set(['content']));
    expect(new Set(kinds({ content: false, polls: true, quiz: false }))).toEqual(new Set(['poll']));
    expect(new Set(kinds({ content: false, polls: false, quiz: true }))).toEqual(new Set(['quiz']));
    expect(new Set(kinds({ content: false, polls: true, quiz: true }))).toEqual(new Set(['poll', 'quiz']));
  });

  it('finds a mapper by kind, not by registry type', () => {
    expect(findMapper('multiple_choice_poll')?.type).toBe('select_answer');
    expect(findMapper('multiple_choice_quiz')?.type).toBe('select_answer');
    expect(findMapper('select_answer')).toBeUndefined();
    expect(findMapper('nope')).toBeUndefined();
  });

  it('covers every content and interactive type the registry had before the advanced types', () => {
    const covered = new Set(DECK_SLIDE_MAPPERS.map((mapper) => mapper.type));
    for (const type of ['heading', 'paragraph', 'bullets', 'quote', 'big_number', 'select_answer', 'type_answer', 'wordcloud', 'open_ended', 'scales', 'ranking']) {
      expect(covered.has(type)).toBe(true);
    }
    // Media and system slides need assets or the live engine; they are never generated.
    expect(listSlideTypes().some((def) => def.type === 'image')).toBe(true);
    expect(covered.has('image')).toBe(false);
    expect(covered.has('video')).toBe(false);
    expect(covered.has('leaderboard')).toBe(false);
  });
});

describe('mappers validate through the registry schema', () => {
  for (const mapper of DECK_SLIDE_MAPPERS) {
    it(`${mapper.kind} -> ${mapper.type}`, () => {
      const slide = mapOk(mapper.kind, validGenerated(mapper.kind));
      expect(slide.type).toBe(mapper.type);
      expect(slide.notes).toBe('Say something about slide 1.');
    });
  }

  it('heading becomes content with title and subtitle', () => {
    expect(mapOk('heading', { title: ' Hello  world ', subtitle: 'Sub', notes: 'n' })).toMatchObject({
      type: 'heading',
      content: { title: 'Hello world', subtitle: 'Sub' },
    });
  });

  it('bullets are deduplicated and capped at 10', () => {
    const slide = mapOk('bullets', { title: 'T', items: ['A', 'a', 'B', ...Array.from({ length: 20 }, (_, i) => `Item ${i}`)] });
    const items = (slide.content as { items: string[] }).items;
    expect(items.slice(0, 2)).toEqual(['A', 'B']);
    expect(items).toHaveLength(10);
  });

  it('big_number needs a finite number', () => {
    expect(toRegistrySlide(mapperOf('big_number'), { label: 'x' }).ok).toBe(false);
    expect(toRegistrySlide(mapperOf('big_number'), { value: Number.POSITIVE_INFINITY, label: 'x' }).ok).toBe(false);
    expect(mapOk('big_number', { value: 7, label: 'x', prefix: '$' }).content).toMatchObject({ value: 7, prefix: '$' });
  });

  it('a graded quiz question keeps points, the time limit and the explanation', () => {
    const slide = mapOk('multiple_choice_quiz', validGenerated('multiple_choice_quiz'));
    expect(slide).toMatchObject({ points: 1000, timeLimit: 30, scoreDependsOnTime: true });
    expect(slide.options?.filter((option) => option.isCorrect)).toHaveLength(1);
    expect(slide.config).toMatchObject({ allowMultiple: false, explanation: 'Because.' });
  });

  it('a quiz with several right answers becomes multi-select', () => {
    const slide = mapOk('multiple_choice_quiz', {
      question: 'Pick the primes',
      options: [
        { text: '2', isCorrect: true },
        { text: '3', isCorrect: true },
        { text: '4', isCorrect: false },
      ],
    });
    expect(slide.config).toMatchObject({ allowMultiple: true });
  });

  it('a quiz question without a right answer is invalid (and a poll never has one)', () => {
    const result = toRegistrySlide(mapperOf('multiple_choice_quiz'), {
      question: 'Q?',
      options: [
        { text: 'A', isCorrect: false },
        { text: 'B', isCorrect: false },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('correct');

    const poll = mapOk('multiple_choice_poll', {
      question: 'Which?',
      options: [
        { text: 'A', isCorrect: true },
        { text: 'B', isCorrect: true },
      ],
    });
    expect(poll.options?.every((option) => !option.isCorrect)).toBe(true);
    expect(poll.points).toBe(0);
  });

  it('rejects questions with too few options and duplicate options collapse', () => {
    expect(toRegistrySlide(mapperOf('multiple_choice_poll'), { question: 'Q?', options: [{ text: 'A', isCorrect: false }] }).ok).toBe(false);
    expect(
      toRegistrySlide(mapperOf('multiple_choice_poll'), {
        question: 'Q?',
        options: [
          { text: 'A', isCorrect: false },
          { text: ' a ', isCorrect: false },
        ],
      }).ok,
    ).toBe(false);
  });

  it('keeps at most 6 options', () => {
    const slide = mapOk('multiple_choice_poll', {
      question: 'Q?',
      options: Array.from({ length: 9 }, (_, i) => ({ text: `Option ${i}`, isCorrect: false })),
    });
    expect(slide.options).toHaveLength(6);
  });

  it('interactive polls are ungraded with no correct answers', () => {
    for (const kind of ['multiple_choice_poll', 'wordcloud', 'open_ended', 'scales', 'ranking']) {
      expect(mapOk(kind, validGenerated(kind))).toMatchObject({ points: 0, scoreDependsOnTime: false });
    }
  });

  it('scales and ranking need their lists', () => {
    expect(toRegistrySlide(mapperOf('scales'), { question: 'Rate', statements: [] }).ok).toBe(false);
    expect(toRegistrySlide(mapperOf('ranking'), { question: 'Order', items: ['only one'] }).ok).toBe(false);
    expect(mapOk('scales', validGenerated('scales'))).toMatchObject({ statements: ['I get it'], minLabel: 'No', maxLabel: 'Yes' });
  });

  it('type_answer needs an accepted answer', () => {
    expect(toRegistrySlide(mapperOf('type_answer'), { question: 'Q?' }).ok).toBe(false);
    expect(mapOk('type_answer', validGenerated('type_answer'))).toMatchObject({ acceptedAnswers: ['yes'], points: 1000 });
  });

  it('every interactive kind needs a question', () => {
    for (const kind of ['multiple_choice_quiz', 'type_answer', 'multiple_choice_poll', 'wordcloud', 'open_ended', 'scales', 'ranking']) {
      const result = toRegistrySlide(mapperOf(kind), { ...validGenerated(kind), question: '   ' });
      expect(result.ok).toBe(false);
    }
  });

  it('missing, null and non-object outputs are invalid, not exceptions', () => {
    for (const value of [undefined, null, 'text', 42] as unknown[]) {
      const result = toRegistrySlide(mapperOf('bullets'), value as GeneratedSlide);
      expect(result.ok).toBe(false);
    }
  });

  it('survives wrong field types from the model', () => {
    const weird = { title: 5, items: 'not a list', question: { a: 1 }, options: 'x', notes: 7, value: '12' } as unknown as GeneratedSlide;
    for (const mapper of DECK_SLIDE_MAPPERS) expect(() => toRegistrySlide(mapper, weird)).not.toThrow();
  });
});

describe('speaker notes', () => {
  it('are kept, cleaned and flagged when missing', () => {
    const withNotes = toRegistrySlide(mapperOf('bullets'), { ...validGenerated('bullets'), notes: '  First line.\n\n\n\nSecond   line.  ' });
    expect(withNotes.ok && withNotes.slide.notes).toBe('First line.\n\nSecond line.');
    expect(withNotes.ok && withNotes.notesMissing).toBe(false);

    const without = toRegistrySlide(mapperOf('bullets'), { ...validGenerated('bullets'), notes: '   ' });
    expect(without.ok && without.notesMissing).toBe(true);
  });

  it('are capped well below the stored limit', () => {
    const slide = mapOk('bullets', { ...validGenerated('bullets'), notes: 'word '.repeat(2000) });
    expect(slide.notes.length).toBeLessThanOrEqual(NOTES_MAX);
    expect(NOTES_MAX).toBeLessThan(5000);
  });
});

describe('text hygiene', () => {
  it('strips control, zero-width and bidi characters', () => {
    expect(cleanText('a\u0000b‮c​d\u0007e', 50)).toBe('abcde');
    expect(cleanText('line one\r\nline two', 50, { multiline: true })).toBe('line one\nline two');
    expect(cleanText('too   many\n spaces', 50)).toBe('too many spaces');
  });

  it('truncates with an ellipsis and ignores non-strings', () => {
    expect(cleanText('abcdefghij', 5)).toBe('abcd…');
    expect(cleanText(undefined, 5)).toBe('');
    expect(cleanText(12, 5)).toBe('');
  });

  it('cleanList drops blanks and duplicates and honours the cap', () => {
    expect(cleanList([' a ', 'A', '', 3, 'b', 'c'], 2, 10)).toEqual(['a', 'b']);
    expect(cleanList('nope', 3, 10)).toEqual([]);
  });

  it('links never survive into slide text', () => {
    expect(stripMarkdownLinks('see [the docs](https://evil.example/x) now')).toBe('see the docs now');
    const slide = mapOk('paragraph', { title: 'T', body: 'Read [more](https://evil.example) here.', notes: 'n' });
    expect((slide.content as { body: string }).body).toBe('Read more here.');
    const bullets = mapOk('bullets', { items: ['[click](javascript:alert(1)) me'], notes: 'n' });
    expect((bullets.content as { items: string[] }).items).toEqual(['click me']);
  });
});
