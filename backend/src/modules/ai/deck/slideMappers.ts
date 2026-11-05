import { getSlideType, hasSlideType, type ParsedSlide } from '../../presentations/slides';
import type { DeckInclude, GeneratedSlide } from './deck.schema';

/**
 * Generated slide → registry slide. Each entry is a *deck kind*: the name the
 * model and the outline use, the registry type it becomes, the prompt hint that
 * says which fields to fill, and `map`, which builds a request-shaped slide
 * that the registry type's own schema then validates (`toRegistrySlide`).
 *
 * Kinds are offered only while their registry type is registered at runtime
 * (`availableKinds`), so a type removed from the registry is never generated.
 * Adding a type is one entry here. Two kinds share `select_answer`: a graded
 * quiz question and an ungraded opinion poll (0 points).
 */

export type DeckCategory = 'content' | 'poll' | 'quiz';

export interface DeckSlideMapper {
  kind: string;
  /** Registry slide type it maps to. */
  type: string;
  category: DeckCategory;
  /** For the prompt: what the kind is for and which fields to fill. */
  hint: string;
  map(slide: GeneratedSlide): Record<string, unknown>;
}

// ---------- Output caps and text hygiene ----------

/** Speaker notes are stored up to 5000 chars; generated ones are capped well below. */
export const NOTES_MAX = 2000;
const QUIZ_TIME_LIMIT = 30;
const POLL_TIME_LIMIT = 45;
const MAX_OPTIONS = 6;

// C0 controls except tab/newline, DEL, C1 controls, zero-width and bidi overrides.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/** Trimmed text without control characters, cut to `max` (with an ellipsis). */
export const cleanText = (value: unknown, max: number, { multiline = false } = {}): string => {
  if (typeof value !== 'string') return '';
  let text = value.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n');
  text = multiline
    ? text
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ');
  text = text.trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

/** Non-empty cleaned entries, case-insensitively unique, at most `maxItems`. */
export const cleanList = (value: unknown, maxItems: number, maxLength: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === maxItems) break;
  }
  return out;
};

/**
 * Generated text never carries links: `[text](url)` becomes `text`. A link in
 * a generated slide could come from injected source material, and the author
 * can add real links in the builder.
 */
export const stripMarkdownLinks = (text: string) =>
  // The target may hold one level of parentheses, e.g. javascript:alert(1).
  text.replace(/\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1');

const notesOf = (slide: GeneratedSlide) => cleanText(slide.notes, NOTES_MAX, { multiline: true });

const options = (slide: GeneratedSlide) => {
  const seen = new Set<string>();
  const out: { text: string; isCorrect: boolean }[] = [];
  for (const option of Array.isArray(slide.options) ? slide.options : []) {
    const text = cleanText(option?.text, 200);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({ text, isCorrect: option?.isCorrect === true });
    if (out.length === MAX_OPTIONS) break;
  }
  return out;
};

const finiteNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// ---------- Mappers ----------

export const DECK_SLIDE_MAPPERS: readonly DeckSlideMapper[] = [
  {
    kind: 'heading',
    type: 'heading',
    category: 'content',
    hint: 'A title or section divider slide. Fields: title (at most 80 characters), subtitle (optional, at most 150).',
    map: (slide) => ({
      type: 'heading',
      notes: notesOf(slide),
      content: { title: cleanText(slide.title, 150), subtitle: cleanText(slide.subtitle, 300) },
    }),
  },
  {
    kind: 'paragraph',
    type: 'paragraph',
    category: 'content',
    hint:
      'A short explanation. Fields: title (optional), body (one to three short paragraphs, at most 900 characters; ' +
      '**bold** and *italic* allowed, no links).',
    map: (slide) => ({
      type: 'paragraph',
      notes: notesOf(slide),
      content: {
        title: cleanText(slide.title, 150),
        body: cleanText(stripMarkdownLinks(typeof slide.body === 'string' ? slide.body : ''), 2000, { multiline: true }),
      },
    }),
  },
  {
    kind: 'bullets',
    type: 'bullets',
    category: 'content',
    hint: 'Key points. Fields: title (optional), items (3 to 6 bullets, each at most 120 characters).',
    map: (slide) => ({
      type: 'bullets',
      notes: notesOf(slide),
      content: {
        title: cleanText(slide.title, 150),
        items: cleanList(
          (Array.isArray(slide.items) ? slide.items : []).map((item) =>
            typeof item === 'string' ? stripMarkdownLinks(item) : item,
          ),
          10,
          200,
        ),
      },
    }),
  },
  {
    kind: 'quote',
    type: 'quote',
    category: 'content',
    hint:
      'A quotation. Fields: text (at most 300 characters), attribution (who said it). Use only a real quotation you ' +
      'are sure of or one from the source material; never invent a quotation or a source.',
    map: (slide) => ({
      type: 'quote',
      notes: notesOf(slide),
      content: { text: cleanText(slide.text, 500), attribution: cleanText(slide.attribution, 150) },
    }),
  },
  {
    kind: 'big_number',
    type: 'big_number',
    category: 'content',
    hint:
      'One striking figure. Fields: value (a number), prefix (optional, e.g. "$"), suffix (optional, e.g. "%"), ' +
      'label (what the number means). Use only figures you are confident about or that appear in the source material.',
    map: (slide) => ({
      type: 'big_number',
      notes: notesOf(slide),
      content: {
        value: finiteNumber(slide.value),
        label: cleanText(slide.label, 150),
        prefix: cleanText(slide.prefix, 12),
        suffix: cleanText(slide.suffix, 12),
      },
    }),
  },
  {
    kind: 'multiple_choice_quiz',
    type: 'select_answer',
    category: 'quiz',
    hint:
      'A quiz question with one right answer. Fields: question (at most 200 characters), options (3 or 4 choices, ' +
      'each at most 80 characters, exactly one with isCorrect true), explanation (one sentence: why it is right).',
    map: (slide) => {
      const choices = options(slide);
      return {
        type: 'select_answer',
        question: cleanText(slide.question, 500),
        notes: notesOf(slide),
        options: choices,
        timeLimit: QUIZ_TIME_LIMIT,
        points: 1000,
        scoreDependsOnTime: true,
        config: {
          allowMultiple: choices.filter((choice) => choice.isCorrect).length > 1,
          explanation: cleanText(slide.explanation, 2000),
        },
      };
    },
  },
  {
    kind: 'type_answer',
    type: 'type_answer',
    category: 'quiz',
    hint:
      'A quiz question answered by typing a short word or number. Fields: question (at most 200 characters), ' +
      'acceptedAnswers (1 to 5 accepted spellings, each one to three words).',
    map: (slide) => ({
      type: 'type_answer',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      acceptedAnswers: cleanList(slide.acceptedAnswers, 10, 200),
      timeLimit: QUIZ_TIME_LIMIT,
      points: 1000,
      scoreDependsOnTime: true,
    }),
  },
  {
    kind: 'multiple_choice_poll',
    type: 'select_answer',
    category: 'poll',
    hint:
      'An opinion poll with no right answer. Fields: question (at most 200 characters), options (2 to 5 choices, ' +
      'each at most 80 characters, every isCorrect false).',
    map: (slide) => ({
      type: 'select_answer',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      // A poll has no right answer: 0 points makes the slide ungraded.
      options: options(slide).map((choice) => ({ text: choice.text, isCorrect: false })),
      timeLimit: POLL_TIME_LIMIT,
      points: 0,
      scoreDependsOnTime: false,
    }),
  },
  {
    kind: 'wordcloud',
    type: 'wordcloud',
    category: 'poll',
    hint: 'The audience answers with a word or two, shown as a word cloud. Fields: question (at most 200 characters).',
    map: (slide) => ({
      type: 'wordcloud',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      maxEntries: 3,
      timeLimit: POLL_TIME_LIMIT,
      points: 0,
      scoreDependsOnTime: false,
    }),
  },
  {
    kind: 'open_ended',
    type: 'open_ended',
    category: 'poll',
    hint: 'The audience writes a free-text answer. Fields: question (at most 200 characters).',
    map: (slide) => ({
      type: 'open_ended',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      timeLimit: POLL_TIME_LIMIT,
      points: 0,
      scoreDependsOnTime: false,
    }),
  },
  {
    kind: 'scales',
    type: 'scales',
    category: 'poll',
    hint:
      'The audience rates statements from 1 to 5. Fields: question, statements (1 to 4 statements), minLabel and ' +
      'maxLabel (e.g. "Disagree" and "Agree").',
    map: (slide) => ({
      type: 'scales',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      statements: cleanList(slide.statements, 10, 200),
      minLabel: cleanText(slide.minLabel, 40),
      maxLabel: cleanText(slide.maxLabel, 40),
      scaleMax: 5,
      timeLimit: POLL_TIME_LIMIT,
      points: 0,
      scoreDependsOnTime: false,
    }),
  },
  {
    kind: 'ranking',
    type: 'ranking',
    category: 'poll',
    hint: 'The audience orders items by priority. Fields: question, items (3 to 6 items, each at most 80 characters).',
    map: (slide) => ({
      type: 'ranking',
      question: cleanText(slide.question, 500),
      notes: notesOf(slide),
      items: cleanList(slide.items, 10, 200),
      timeLimit: POLL_TIME_LIMIT,
      points: 0,
      scoreDependsOnTime: false,
    }),
  },
];

const INCLUDE_KEY: Record<DeckCategory, keyof DeckInclude> = { content: 'content', poll: 'polls', quiz: 'quiz' };

/**
 * Kinds whose registry type exists right now, optionally limited to the
 * categories the author asked for. Read at call time, so the list follows
 * whatever the registry holds.
 */
export const availableKinds = (include?: DeckInclude, registered: (type: string) => boolean = hasSlideType): DeckSlideMapper[] =>
  DECK_SLIDE_MAPPERS.filter((mapper) => registered(mapper.type) && (!include || include[INCLUDE_KEY[mapper.category]]));

export const findMapper = (kind: string): DeckSlideMapper | undefined =>
  availableKinds().find((mapper) => mapper.kind === kind);

// ---------- Validation ----------

export type MappedSlide =
  | { ok: true; slide: ParsedSlide; notesMissing: boolean }
  | { ok: false; issues: string[] };

const formatIssues = (issues: readonly { path: PropertyKey[]; message: string }[]) =>
  issues.slice(0, 8).map((issue) => (issue.path.length ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message));

/**
 * Maps one generated slide and validates it with the registry type's own
 * schema (`safeParse`), so a slide that passes here is exactly what
 * `POST /api/presentations` would store.
 */
export const toRegistrySlide = <S extends GeneratedSlide>(
  mapper: { type: string; map(slide: S): Record<string, unknown> },
  generated: S | undefined,
): MappedSlide => {
  if (!generated || typeof generated !== 'object') return { ok: false, issues: ['The slide is missing from the output'] };
  const def = getSlideType(mapper.type);
  if (!def) return { ok: false, issues: [`Slide type "${mapper.type}" is not available`] };
  const result = def.schema.safeParse(mapper.map(generated));
  if (!result.success) return { ok: false, issues: formatIssues(result.error.issues) };
  return { ok: true, slide: result.data, notesMissing: !result.data.notes.trim() };
};
