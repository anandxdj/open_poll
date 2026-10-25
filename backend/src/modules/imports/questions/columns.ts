/**
 * The question-import template: one wide table, one question per row.
 * Contract for CSV and XLSX alike; documented in
 * backend/docs/wiki/modules/imports.md.
 */

export const MAX_OPTIONS = 8;
export const OPTION_COLUMNS = Array.from({ length: MAX_OPTIONS }, (_, i) => `option_${i + 1}`);

/** Template columns in order. `type` and `question` are required. */
export const TEMPLATE_COLUMNS = [
  'type',
  'question',
  ...OPTION_COLUMNS,
  'correct',
  'accepted_answers',
  'statements',
  'items',
  'min_label',
  'max_label',
  'scale_max',
  'max_entries',
  'points',
  'time_limit',
  'explanation',
  'notes',
] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

export const REQUIRED_COLUMNS: readonly TemplateColumn[] = ['type', 'question'];

/** Importable slide types, with the words people type for them. */
export const QUESTION_TYPES = ['select_answer', 'type_answer', 'wordcloud', 'open_ended', 'scales', 'ranking'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const TYPE_ALIASES = new Map<string, QuestionType>(Object.entries({
  select_answer: 'select_answer',
  multiple_choice: 'select_answer',
  multiple_select: 'select_answer',
  choice: 'select_answer',
  mc: 'select_answer',
  mcq: 'select_answer',
  select: 'select_answer',
  poll: 'select_answer',
  quiz: 'select_answer',
  type_answer: 'type_answer',
  short_answer: 'type_answer',
  fill_in: 'type_answer',
  fill_in_the_blank: 'type_answer',
  wordcloud: 'wordcloud',
  word_cloud: 'wordcloud',
  open_ended: 'open_ended',
  open: 'open_ended',
  free_text: 'open_ended',
  scales: 'scales',
  scale: 'scales',
  rating: 'scales',
  likert: 'scales',
  ranking: 'ranking',
  rank: 'ranking',
  order: 'ranking',
} as Record<string, QuestionType>));

/** Underscore-separated lowercase key for a header or a type word. */
export const normalizeKey = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const questionTypeOf = (value: string): QuestionType | null => TYPE_ALIASES.get(normalizeKey(value)) ?? null;

const HEADER_ALIASES = new Map<string, TemplateColumn>(Object.entries({
  slide_type: 'type',
  question_type: 'type',
  question_text: 'question',
  text: 'question',
  prompt: 'question',
  correct_answer: 'correct',
  correct_answers: 'correct',
  correct_option: 'correct',
  correct_options: 'correct',
  answer: 'correct',
  answers: 'accepted_answers',
  accepted: 'accepted_answers',
  accepted_answer: 'accepted_answers',
  statement: 'statements',
  item: 'items',
  min: 'min_label',
  max: 'max_label',
  minimum_label: 'min_label',
  maximum_label: 'max_label',
  scale: 'scale_max',
  scale_size: 'scale_max',
  entries: 'max_entries',
  time: 'time_limit',
  timer: 'time_limit',
  seconds: 'time_limit',
  time_limit_seconds: 'time_limit',
  speaker_notes: 'notes',
} as Record<string, TemplateColumn>));

const KNOWN = new Set<string>(TEMPLATE_COLUMNS);

/** The template column a header cell means, or null when it is not one (then it is ignored with a warning). */
export function columnOf(header: string): TemplateColumn | null {
  const key = normalizeKey(header);
  if (KNOWN.has(key)) return key as TemplateColumn;
  const option = key.match(/^(?:option|choice|answer)_?([1-9])$/);
  if (option) return `option_${option[1]}` as TemplateColumn;
  return HEADER_ALIASES.get(key) ?? null;
}

/** Example rows of the downloadable templates: one per type, in template column order. */
export const EXAMPLE_ROWS: ReadonlyArray<Partial<Record<TemplateColumn, string>>> = [
  {
    type: 'select_answer',
    question: 'Which planet is closest to the sun?',
    option_1: 'Mercury',
    option_2: 'Venus',
    option_3: 'Earth',
    option_4: 'Mars',
    correct: '1',
    points: '1000',
    time_limit: '20',
    explanation: 'Mercury orbits closest, at about 58 million km.',
    notes: 'Pause here for a show of hands first.',
  },
  {
    type: 'select_answer',
    question: 'Which of these are prime numbers? (pick all)',
    option_1: '2',
    option_2: '9',
    option_3: '11',
    option_4: '15',
    correct: '1,3',
    time_limit: '30',
  },
  {
    type: 'select_answer',
    question: 'How was today\'s session? (no correct answer: a survey question)',
    option_1: 'Great',
    option_2: 'Okay',
    option_3: 'Needs work',
  },
  {
    type: 'type_answer',
    question: 'What is the capital of France?',
    accepted_answers: 'Paris|paris, france',
    points: '500',
    time_limit: '30',
  },
  { type: 'wordcloud', question: 'One word for how you feel today', max_entries: '3' },
  { type: 'open_ended', question: 'What should we cover next time?' },
  {
    type: 'scales',
    question: 'How much do you agree?',
    statements: 'The pace was right|The examples were clear',
    min_label: 'Disagree',
    max_label: 'Agree',
    scale_max: '5',
  },
  { type: 'ranking', question: 'Rank these topics by interest', items: 'Pricing|Roadmap|Security|Support' },
];

/** Plain-language description of every column, shown on the template's Instructions sheet. */
export const COLUMN_HELP: ReadonlyArray<[column: string, help: string]> = [
  ['type', 'Required. select_answer (multiple choice), type_answer, wordcloud, open_ended, scales or ranking.'],
  ['question', 'Required. The question or prompt, up to 500 characters.'],
  ['option_1 … option_8', 'select_answer: the answer options (2 to 8).'],
  [
    'correct',
    'select_answer: the right option(s), as option numbers ("2" or "1,3") or the option text. Leave empty for a survey question without a right answer.',
  ],
  ['accepted_answers', 'type_answer: every accepted answer, separated by | (case and spacing are ignored).'],
  ['statements', 'scales: the statements people rate, separated by | (1 to 10).'],
  ['items', 'ranking: the items to put in order, separated by | (2 to 10).'],
  ['min_label, max_label', 'scales: labels for the lowest and highest rating.'],
  ['scale_max', 'scales: the highest rating, 2 to 10 (default 5).'],
  ['max_entries', 'wordcloud: words each person may submit, 1 to 3 (default 3).'],
  ['points', 'select_answer, type_answer: points for a correct answer, 0 to 10000 (default 1000; 0 makes it a survey question).'],
  ['time_limit', 'Seconds, 5 to 300. Quiz questions default to 30; the other types default to 0 (open until you close them).'],
  ['explanation', 'select_answer: why the answer is right, shown to you after the reveal.'],
  ['notes', 'Speaker notes, visible to you only.'],
];
