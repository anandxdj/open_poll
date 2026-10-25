import { describe, expect, it } from 'bun:test';
import ExcelJS from 'exceljs';
import { ImportError } from '../src/modules/imports/errors';
import { columnOf, questionTypeOf, TEMPLATE_COLUMNS } from '../src/modules/imports/questions/columns';
import { parseQuestionFile, questionsTemplateCsv, questionsTemplateXlsx } from '../src/modules/imports/questions';
import { readCsv, cellText } from '../src/modules/imports/questions/table';
import { BAD_ROWS, GOOD_ROWS, QUESTIONS_HEADER, csvOf, xlsxOf } from './fixtures/imports/questions';
import { zipBomb } from './fixtures/imports/pptx';

const enc = (text: string) => new TextEncoder().encode(text);
const parseCsv = (text: string, options?: Parameters<typeof parseQuestionFile>[1]) => parseQuestionFile(enc(text), options);

describe('question columns', () => {
  it('maps aliases and numbered options', () => {
    expect(columnOf('Question Text')).toBe('question');
    expect(columnOf(' Option 3 ')).toBe('option_3');
    expect(columnOf('choice2')).toBe('option_2');
    expect(columnOf('Correct Answer')).toBe('correct');
    expect(columnOf('time (seconds)')).toBeNull();
    expect(columnOf('Time')).toBe('time_limit');
    expect(columnOf('favourite food')).toBeNull();
    expect(TEMPLATE_COLUMNS.every((column) => columnOf(column) === column)).toBe(true);
  });

  it('maps type words', () => {
    expect(questionTypeOf('Multiple Choice')).toBe('select_answer');
    expect(questionTypeOf('word cloud')).toBe('wordcloud');
    expect(questionTypeOf('Likert')).toBe('scales');
    expect(questionTypeOf('leaderboard')).toBeNull();
    expect(questionTypeOf('')).toBeNull();
  });
});

describe('questions from CSV', () => {
  it('turns every good row into a validated slide of the right type', async () => {
    const parsed = await parseCsv(csvOf(GOOD_ROWS));
    expect(parsed.errors).toEqual([]);
    expect(parsed.kind).toBe('csv');
    expect(parsed.questions.map((q) => q.type)).toEqual([
      'select_answer',
      'select_answer',
      'select_answer',
      'type_answer',
      'wordcloud',
      'open_ended',
      'scales',
      'ranking',
    ]);
    expect(parsed.questions.map((q) => q.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);

    const [single, multi, survey, typed, cloud, open, scales, ranking] = parsed.questions.map((q) => q.slide as Record<string, any>);
    expect(single).toMatchObject({
      type: 'select_answer',
      question: 'Capital of France?',
      timeLimit: 20,
      points: 1000,
      notes: 'Smile.',
      config: { allowMultiple: false, explanation: 'Paris, on the Seine.' },
    });
    expect(single!.options).toEqual([
      { text: 'Paris', isCorrect: true },
      { text: 'Rome', isCorrect: false },
      { text: 'Madrid', isCorrect: false },
    ]);
    expect(multi!.config).toMatchObject({ allowMultiple: true });
    expect(multi!.options.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual([true, false, true]);
    expect(survey).toMatchObject({ points: 0, timeLimit: 30 });
    expect(survey!.options.some((o: { isCorrect: boolean }) => o.isCorrect)).toBe(false);
    expect(typed).toMatchObject({ type: 'type_answer', acceptedAnswers: ['4', 'four'], points: 500 });
    expect(cloud).toMatchObject({ type: 'wordcloud', maxEntries: 2, timeLimit: 0 });
    expect(open).toMatchObject({ type: 'open_ended', timeLimit: 0 });
    expect(scales).toMatchObject({ statements: ['Pace', 'Clarity'], minLabel: 'Low', maxLabel: 'High', scaleMax: 7 });
    expect(ranking).toMatchObject({ items: ['Alpha', 'Beta', 'Gamma'] });
  });

  it('reports each bad row with its spreadsheet row and column, and keeps the good ones', async () => {
    const parsed = await parseCsv(csvOf([...GOOD_ROWS.slice(0, 2), ...BAD_ROWS]));
    expect(parsed.questions.map((q) => q.row)).toEqual([2, 3]);
    expect(parsed.errors.map((e) => e.row)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    for (const error of parsed.errors) expect(error.message.length).toBeGreaterThan(5);
    const byRow = new Map(parsed.errors.map((e) => [e.row, e]));
    expect(byRow.get(4)).toMatchObject({ column: 'option_1' });
    expect(byRow.get(5)).toMatchObject({ column: 'correct', message: expect.stringContaining('option 3') });
    expect(byRow.get(6)).toMatchObject({ column: 'type' });
    expect(byRow.get(7)).toMatchObject({ column: 'question' });
    expect(byRow.get(8)).toMatchObject({ column: 'accepted_answers' });
    expect(byRow.get(9)).toMatchObject({ column: 'scale_max' });
    expect(byRow.get(10)).toMatchObject({ column: 'points', message: expect.stringContaining('whole number') });
    expect(byRow.get(11)).toMatchObject({ column: 'items' });
  });

  it('accepts option text in the correct column and rejects text that is not an option', async () => {
    const ok = await parseCsv(csvOf([{ type: 'select_answer', question: 'Q', option_1: 'Yes', option_2: 'No', correct: 'no' }]));
    expect(ok.questions[0]!.slide.options).toEqual([
      { text: 'Yes', isCorrect: false },
      { text: 'No', isCorrect: true },
    ]);
    const bad = await parseCsv(csvOf([{ type: 'select_answer', question: 'Q', option_1: 'Yes', option_2: 'No', correct: 'maybe' }]));
    expect(bad.errors[0]).toMatchObject({ column: 'correct' });
  });

  it('refuses correct-less questions that ask for points, and gaps in the options', async () => {
    const parsed = await parseCsv(
      csvOf([
        { type: 'select_answer', question: 'Q1', option_1: 'A', option_2: 'B', points: '500' },
        { type: 'select_answer', question: 'Q2', option_1: 'A', option_3: 'C', correct: '1' },
      ]),
    );
    expect(parsed.questions).toHaveLength(0);
    expect(parsed.errors.map((e) => e.column)).toEqual(['correct', 'option_2']);
  });

  it('applies the capacity: rows beyond it are skipped with a message', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ type: 'open_ended', question: `Q${i + 1}` }));
    const parsed = await parseCsv(csvOf(rows), { capacity: 3 });
    expect(parsed.questions).toHaveLength(3);
    expect(parsed.errors.map((e) => e.row)).toEqual([5, 6]);
    expect(parsed.errors[0]!.message).toContain('room for 3 more');
  });

  it('needs the type and question columns', async () => {
    await expect(parseCsv('foo,bar\r\n1,2')).rejects.toMatchObject({ code: 'QUESTIONS_HEADER_INVALID' });
    await expect(parseCsv('type\r\nopen_ended')).rejects.toThrow(/question/);
  });

  it('warns about unknown and repeated columns instead of failing', async () => {
    const parsed = await parseCsv('type,question,mood,question\r\nopen_ended,Hello?,happy,ignored');
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]!.question).toBe('Hello?');
    expect(parsed.warnings.map((w) => w.code)).toEqual(['COLUMN_IGNORED', 'COLUMN_DUPLICATE']);
  });

  it('reads semicolon-separated files, quoted newlines, a BOM and skips blank rows', async () => {
    const text = '﻿type;question;option_1;option_2;correct\r\nselect_answer;"Line one\nline two";A;B;1\r\n;;;;\r\n\r\nopen_ended;Last;;;\r\n';
    const parsed = await parseCsv(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions.map((q) => [q.row, q.question])).toEqual([
      [2, 'Line one line two'],
      [5, 'Last'],
    ]);
  });

  it('decodes Windows-1252 and UTF-16 exports', async () => {
    const latin = Uint8Array.from([...enc('type,question\r\nopen_ended,Caf'), 0xe9, ...enc('?')]);
    expect((await parseQuestionFile(latin)).questions[0]!.question).toBe('Café?');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('type,question\r\nopen_ended,Ünï?', 'utf16le')]);
    expect((await parseQuestionFile(new Uint8Array(utf16))).questions[0]!.question).toBe('Ünï?');
  });

  it('treats formulas, prototype-polluting headers and control characters as plain text', async () => {
    const parsed = await parseCsv(
      'type,question,__proto__,constructor\r\nopen_ended,"=HYPERLINK(""http://evil"",""x"")",polluted,polluted2\r\nopen_ended,"Bad\u0000 text\u0007",,',
    );
    expect(parsed.questions.map((q) => q.question)).toEqual(['=HYPERLINK("http://evil","x")', 'Bad text']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(parsed.warnings.map((w) => w.code)).toEqual(['COLUMN_IGNORED', 'COLUMN_IGNORED']);
  });

  it('rejects empty files, broken quoting, oversized files and too many rows', async () => {
    await expect(parseQuestionFile(new Uint8Array())).rejects.toBeInstanceOf(ImportError);
    await expect(parseCsv('type,question\r\nopen_ended,"never closed')).rejects.toMatchObject({ code: 'QUESTIONS_UNREADABLE' });
    await expect(parseQuestionFile(new Uint8Array(2 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    const many = `type,question\r\n${'open_ended,Q\r\n'.repeat(1200)}`;
    await expect(parseCsv(many)).rejects.toMatchObject({ code: 'QUESTIONS_TOO_MANY_ROWS' });
  });

  it('cuts overlong cells and reports the field limit instead of failing the parse', async () => {
    const parsed = await parseCsv(`type,question,notes\r\nopen_ended,"${'q'.repeat(9000)}",fine`);
    expect(parsed.errors[0]).toMatchObject({ row: 2, column: 'question' });
    const notes = await parseCsv(`type,question,notes\r\nopen_ended,Q,"${'n'.repeat(9000)}"`);
    expect((notes.questions[0]!.slide.notes as string).length).toBe(5000);
  });
});

describe('questions from XLSX', () => {
  it('reads the same rows as the CSV', async () => {
    const parsed = await parseQuestionFile(await xlsxOf([...GOOD_ROWS, ...BAD_ROWS.slice(0, 2)]));
    expect(parsed.kind).toBe('xlsx');
    expect(parsed.questions).toHaveLength(GOOD_ROWS.length);
    expect(parsed.errors.map((e) => e.row)).toEqual([10, 11]);
    expect(parsed.questions[0]!.question).toBe('Capital of France?');
  });

  it('uses the cached result of formula cells, never the formula', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Q');
    sheet.addRow(['type', 'question', 'option_1', 'option_2', 'correct']);
    sheet.addRow([
      'select_answer',
      { formula: '"What is "&"2+2?"', result: 'What is 2+2?' } as ExcelJS.CellFormulaValue,
      { richText: [{ text: 'F' }, { text: 'our' }] } as ExcelJS.CellRichTextValue,
      4,
      { formula: 'A1', result: 1 } as ExcelJS.CellFormulaValue,
    ]);
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const parsed = await parseQuestionFile(buffer);
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions[0]!.question).toBe('What is 2+2?');
    expect(parsed.questions[0]!.slide.options).toEqual([
      { text: 'Four', isCorrect: true },
      { text: '4', isCorrect: false },
    ]);
  });

  it('flattens other cell value shapes to text', () => {
    expect(cellText(new Date('2026-03-04T00:00:00Z'))).toBe('2026-03-04');
    expect(cellText({ text: 'Link', hyperlink: 'http://x' })).toBe('Link');
    expect(cellText({ error: '#REF!' })).toBe('');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText(Number.NaN)).toBe('');
    expect(cellText(null)).toBe('');
  });

  it('reads the first sheet that has data', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Empty');
    const second = workbook.addWorksheet('Data');
    second.addRow(['type', 'question']);
    second.addRow(['open_ended', 'Hello?']);
    const parsed = await parseQuestionFile(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(parsed.questions[0]!.question).toBe('Hello?');
  });

  it('rejects zip bombs and non-workbooks before exceljs sees them', async () => {
    await expect(parseQuestionFile(zipBomb(8 * 1024 * 1024, 'xl/workbook.xml'))).rejects.toMatchObject({ code: 'ARCHIVE_REJECTED' });
    const notWorkbook = Uint8Array.from([0x50, 0x4b, 3, 4, ...new Array(40).fill(0)]);
    await expect(parseQuestionFile(notWorkbook)).rejects.toMatchObject({ code: 'QUESTIONS_UNREADABLE' });
  });
});

describe('templates', () => {
  it('the CSV template parses back into one valid question of each type, with no formulas', async () => {
    const csv = questionsTemplateCsv();
    expect(csv.startsWith('﻿type,question,option_1')).toBe(true);
    const parsed = await parseCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(new Set(parsed.questions.map((q) => q.type)).size).toBe(6);
    expect(readCsv(enc(csv)).headers).toEqual([...TEMPLATE_COLUMNS]);
  });

  it('the XLSX template parses back too, and carries the instructions sheet', async () => {
    const bytes = await questionsTemplateXlsx();
    const parsed = await parseQuestionFile(bytes);
    expect(parsed.errors).toEqual([]);
    expect(new Set(parsed.questions.map((q) => q.type)).size).toBe(6);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Questions', 'Instructions']);
  });

  it('uses every header the fixtures rely on', () => {
    expect(QUESTIONS_HEADER.every((column) => (TEMPLATE_COLUMNS as readonly string[]).includes(column))).toBe(true);
  });
});
