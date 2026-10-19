import { looksLikeZip } from '../bytes';
import { ImportError } from '../errors';
import { IMPORT_LIMITS } from '../limits';
import { parseQuestionRows, type ParseQuestionOptions, type ParsedQuestions } from './rows';
import { readCsv, readXlsx, type Table } from './table';

export { questionsTemplateCsv, questionsTemplateXlsx } from './templates';
export type { ParsedQuestion, ParsedQuestions, QuestionRowError } from './rows';

export type QuestionFileKind = 'csv' | 'xlsx';

/** The file's format by content: an .xlsx workbook is a zip, everything else is read as CSV text. */
export const detectQuestionFile = (bytes: Uint8Array): QuestionFileKind => (looksLikeZip(bytes) ? 'xlsx' : 'csv');

export async function readQuestionTable(bytes: Uint8Array): Promise<{ kind: QuestionFileKind; table: Table }> {
  if (bytes.length === 0) throw new ImportError('QUESTIONS_UNREADABLE', 'The file is empty.');
  if (bytes.length > IMPORT_LIMITS.questions.maxBytes) {
    throw new ImportError('FILE_TOO_LARGE', `Question files can be at most ${IMPORT_LIMITS.questions.maxBytes / (1024 * 1024)} MB.`);
  }
  const kind = detectQuestionFile(bytes);
  return { kind, table: kind === 'xlsx' ? await readXlsx(bytes) : readCsv(bytes) };
}

/** Parses a CSV or XLSX question file into validated slides plus per-row errors. */
export async function parseQuestionFile(
  bytes: Uint8Array,
  options: ParseQuestionOptions = {},
): Promise<ParsedQuestions & { kind: QuestionFileKind }> {
  const { kind, table } = await readQuestionTable(bytes);
  return { kind, ...parseQuestionRows(table, options) };
}
