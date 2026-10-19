import { ImportError, warning, type ImportWarning } from '../errors';
import { IMPORT_LIMITS } from '../limits';
import { presentationSlideSchema } from '../../presentations/presentations.schema';
import { clip, oneLine } from '../text';
import {
  MAX_OPTIONS,
  REQUIRED_COLUMNS,
  columnOf,
  questionTypeOf,
  type QuestionType,
  type TemplateColumn,
} from './columns';
import type { Table, TableRow } from './table';

/**
 * Question rows → slides. Each row is turned into a request-shaped slide and
 * validated by the slide registry's own schema (`presentationSlideSchema`),
 * so an imported question follows exactly the rules of one typed in the
 * builder. A bad row is reported with its spreadsheet row number and skipped;
 * it never fails the others.
 */

export interface QuestionRowError {
  /** Spreadsheet row (the header is row 1). */
  row: number;
  /** Template column the problem is about, when known. */
  column: string | null;
  message: string;
}

export interface ParsedQuestion {
  row: number;
  type: QuestionType;
  question: string;
  /** Short description for the preview table ("4 options, 1 correct"). */
  detail: string;
  /** The slide as the registry schema parsed it (defaults filled in). */
  slide: Record<string, unknown>;
}

export interface ParsedQuestions {
  questions: ParsedQuestion[];
  errors: QuestionRowError[];
  warnings: ImportWarning[];
  /** Non-blank data rows in the file. */
  totalRows: number;
}

export interface ParseQuestionOptions {
  /** How many slides fit (deck cap minus the slides already in the deck). */
  capacity?: number;
}

const LIST_SEPARATOR = '|';
const CORRECT_SEPARATOR = /[,;|]/;

/** Zod issue path root → the template column to blame. */
const PATH_COLUMN = new Map<string, string>(Object.entries({
  question: 'question',
  options: 'option_1',
  acceptedAnswers: 'accepted_answers',
  statements: 'statements',
  items: 'items',
  minLabel: 'min_label',
  maxLabel: 'max_label',
  scaleMax: 'scale_max',
  maxEntries: 'max_entries',
  points: 'points',
  timeLimit: 'time_limit',
  notes: 'notes',
  config: 'explanation',
}));

class RowProblem extends Error {
  constructor(
    readonly column: string | null,
    message: string,
  ) {
    super(message);
  }
}

const problem = (column: string | null, message: string) => new RowProblem(column, message);

const list = (value: string) =>
  value
    .split(LIST_SEPARATOR)
    .map((part) => oneLine(part))
    .filter(Boolean);

function integer(value: string, column: string): number | null {
  if (value === '') return null;
  const parsed = Number(value.replace(',', '.'));
  if (!Number.isInteger(parsed)) throw problem(column, `${column} must be a whole number (got "${clip(value, 20)}")`);
  return parsed;
}

interface Cells {
  get(column: TemplateColumn): string;
}

function selectAnswer(cells: Cells) {
  const options = Array.from({ length: MAX_OPTIONS }, (_, i) => oneLine(cells.get(`option_${i + 1}` as TemplateColumn)));
  // Options must be contiguous from option_1: a gap is almost certainly a mistake.
  const last = options.reduce((end, text, i) => (text ? i + 1 : end), 0);
  const texts = options.slice(0, last);
  const gap = texts.findIndex((text) => !text);
  if (gap >= 0) throw problem(`option_${gap + 1}`, `option_${gap + 1} is empty but option_${last} is filled`);

  const rawCorrect = cells.get('correct');
  const correct = new Set<number>();
  for (const token of rawCorrect.split(CORRECT_SEPARATOR).map((part) => part.trim()).filter(Boolean)) {
    if (/^\d+$/.test(token)) {
      const number = Number(token);
      if (number < 1 || number > texts.length) {
        throw problem('correct', `correct says option ${number}, but there are ${texts.length} options`);
      }
      correct.add(number - 1);
      continue;
    }
    const index = texts.findIndex((text) => text.toLowerCase() === oneLine(token).toLowerCase());
    if (index < 0) throw problem('correct', `correct "${clip(token, 40)}" is not one of the options`);
    correct.add(index);
  }

  const points = integer(cells.get('points'), 'points');
  if (rawCorrect === '' && points !== null && points > 0) {
    throw problem('correct', 'correct is empty but points is above 0: name the right option, or set points to 0 for a survey question');
  }
  const graded = correct.size > 0;
  const explanation = cells.get('explanation').trim();
  const allowMultiple = correct.size > 1;
  return {
    slide: {
      options: texts.map((text, i) => ({ text, isCorrect: correct.has(i) })),
      points: graded ? (points ?? 1000) : 0,
      config: allowMultiple || explanation ? { allowMultiple, explanation } : null,
    },
    timeDefault: 30,
    detail: graded
      ? `${texts.length} options, ${correct.size} correct${allowMultiple ? ' (pick all)' : ''}`
      : `${texts.length} options (survey, no correct answer)`,
  };
}

function typeAnswer(cells: Cells) {
  const accepted = list(cells.get('accepted_answers'));
  const points = integer(cells.get('points'), 'points');
  return {
    slide: { acceptedAnswers: accepted, points: points ?? 1000 },
    timeDefault: 30,
    detail: `${accepted.length} accepted ${accepted.length === 1 ? 'answer' : 'answers'}`,
  };
}

function wordcloud(cells: Cells) {
  const entries = integer(cells.get('max_entries'), 'max_entries');
  return { slide: { maxEntries: entries ?? 3 }, timeDefault: 0, detail: `up to ${entries ?? 3} words each` };
}

function scales(cells: Cells) {
  const statements = list(cells.get('statements'));
  const scaleMax = integer(cells.get('scale_max'), 'scale_max');
  return {
    slide: {
      statements,
      minLabel: oneLine(cells.get('min_label')),
      maxLabel: oneLine(cells.get('max_label')),
      scaleMax: scaleMax ?? 5,
    },
    timeDefault: 0,
    detail: `${statements.length} ${statements.length === 1 ? 'statement' : 'statements'}, 1 to ${scaleMax ?? 5}`,
  };
}

function ranking(cells: Cells) {
  const items = list(cells.get('items'));
  return { slide: { items }, timeDefault: 0, detail: `${items.length} items` };
}

const BUILDERS: Record<QuestionType, (cells: Cells) => { slide: Record<string, unknown>; timeDefault: number; detail: string }> = {
  select_answer: selectAnswer,
  type_answer: typeAnswer,
  wordcloud,
  open_ended: () => ({ slide: {}, timeDefault: 0, detail: 'free text' }),
  scales,
  ranking,
};

/** Zod's own wording ("Too big: expected number to be <=10") needs the column in front to make sense. */
const GENERIC_ISSUE = /^(too |invalid|expected)/i;

const issueMessage = (issue: { path: PropertyKey[]; message: string }) => {
  const column = PATH_COLUMN.get(String(issue.path[0] ?? '')) ?? null;
  return { column, message: column && GENERIC_ISSUE.test(issue.message) ? `${column}: ${issue.message}` : issue.message };
};

function buildRow(row: TableRow, columns: Map<number, TemplateColumn>): ParsedQuestion {
  const byColumn = new Map<TemplateColumn, string>();
  for (const [index, column] of columns) {
    // The first column wins when a header repeats an alias.
    if (!byColumn.has(column)) byColumn.set(column, (row.cells[index] ?? '').trim());
  }
  const cells: Cells = { get: (column) => byColumn.get(column) ?? '' };

  const rawType = cells.get('type');
  if (!rawType) throw problem('type', 'type is required');
  const type = questionTypeOf(rawType);
  if (!type) throw problem('type', `type "${clip(rawType, 30)}" is not one of select_answer, type_answer, wordcloud, open_ended, scales, ranking`);
  const question = oneLine(cells.get('question'));
  if (!question) throw problem('question', 'question is required');

  const built = BUILDERS[type](cells);
  const rawTime = integer(cells.get('time_limit'), 'time_limit');
  const timeLimit = rawTime ?? built.timeDefault;

  const candidate = {
    type,
    question,
    notes: cells.get('notes'),
    timeLimit,
    ...built.slide,
  };
  const parsed = presentationSlideSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = issueMessage(parsed.error.issues[0]!);
    throw problem(first.column, first.message);
  }
  return { row: row.row, type, question, detail: built.detail, slide: parsed.data as unknown as Record<string, unknown> };
}

/** Maps header cells to template columns; unknown headers are reported once and ignored. */
export function readHeader(table: Table): { columns: Map<number, TemplateColumn>; warnings: ImportWarning[] } {
  const columns = new Map<number, TemplateColumn>();
  const warnings: ImportWarning[] = [];
  const seen = new Set<TemplateColumn>();
  table.headers.forEach((header, index) => {
    if (!header.trim()) return;
    const column = columnOf(header);
    if (!column) {
      warnings.push(warning('COLUMN_IGNORED', `The column "${clip(header, 40)}" is not part of the template and was ignored.`));
      return;
    }
    if (seen.has(column)) {
      warnings.push(warning('COLUMN_DUPLICATE', `The column "${clip(header, 40)}" repeats ${column}; the first one is used.`));
      return;
    }
    seen.add(column);
    columns.set(index, column);
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !seen.has(column));
  if (missing.length > 0) {
    throw new ImportError(
      'QUESTIONS_HEADER_INVALID',
      `The first row must name the columns ${missing.join(' and ')}. Download the template for the expected layout.`,
    );
  }
  return { columns, warnings };
}

export function parseQuestionRows(table: Table, options: ParseQuestionOptions = {}): ParsedQuestions {
  const { columns, warnings } = readHeader(table);
  const capacity = Math.max(0, options.capacity ?? IMPORT_LIMITS.maxSlides);
  const questions: ParsedQuestion[] = [];
  const errors: QuestionRowError[] = [];

  for (const row of table.rows) {
    if (questions.length >= capacity) {
      errors.push({
        row: row.row,
        column: null,
        message: `Skipped: a deck holds at most ${IMPORT_LIMITS.maxSlides} slides${capacity < IMPORT_LIMITS.maxSlides ? ' and this deck has room for ' + capacity + ' more' : ''}.`,
      });
      continue;
    }
    try {
      questions.push(buildRow(row, columns));
    } catch (error) {
      if (!(error instanceof RowProblem)) throw error;
      errors.push({ row: row.row, column: error.column, message: error.message });
    }
  }
  return { questions, errors, warnings, totalRows: table.rows.length };
}
