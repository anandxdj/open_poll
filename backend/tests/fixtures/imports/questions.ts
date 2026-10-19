import ExcelJS from 'exceljs';

export const QUESTIONS_HEADER = [
  'type',
  'question',
  'option_1',
  'option_2',
  'option_3',
  'option_4',
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

type Row = Partial<Record<(typeof QUESTIONS_HEADER)[number], string>>;

/** Good rows of every importable type. */
export const GOOD_ROWS: Row[] = [
  { type: 'select_answer', question: 'Capital of France?', option_1: 'Paris', option_2: 'Rome', option_3: 'Madrid', correct: '1', time_limit: '20', explanation: 'Paris, on the Seine.', notes: 'Smile.' },
  { type: 'multiple_choice', question: 'Pick the primes', option_1: '2', option_2: '4', option_3: '5', correct: '1,3' },
  { type: 'select_answer', question: 'Favourite colour?', option_1: 'Red', option_2: 'Blue' },
  { type: 'type_answer', question: '2 + 2 = ?', accepted_answers: '4|four', points: '500' },
  { type: 'wordcloud', question: 'One word for today', max_entries: '2' },
  { type: 'open_ended', question: 'Any questions?' },
  { type: 'scales', question: 'Rate these', statements: 'Pace|Clarity', min_label: 'Low', max_label: 'High', scale_max: '7' },
  { type: 'ranking', question: 'Order by interest', items: 'Alpha|Beta|Gamma' },
];

/** Rows that must each produce exactly one row error (`row` = spreadsheet row when placed after GOOD_ROWS). */
export const BAD_ROWS: Row[] = [
  { type: 'select_answer', question: 'Only one option', option_1: 'A', correct: '1' },
  { type: 'select_answer', question: 'Correct out of range', option_1: 'A', option_2: 'B', correct: '3' },
  { type: 'bogus', question: 'Unknown type' },
  { type: 'open_ended', question: '' },
  { type: 'type_answer', question: 'No answers' },
  { type: 'scales', question: 'Bad scale', statements: 'One', scale_max: '99' },
  { type: 'select_answer', question: 'Bad points', option_1: 'A', option_2: 'B', correct: '1', points: 'many' },
  { type: 'ranking', question: 'One item', items: 'Solo' },
];

export const csvOf = (rows: Row[], header: readonly string[] = QUESTIONS_HEADER, delimiter = ','): string => {
  const cell = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [header.join(delimiter), ...rows.map((row) => header.map((column) => cell((row as Record<string, string>)[column] ?? '')).join(delimiter))].join('\r\n');
};

export async function xlsxOf(rows: Row[], header: readonly string[] = QUESTIONS_HEADER): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Questions');
  sheet.addRow([...header]);
  for (const row of rows) sheet.addRow(header.map((column) => (row as Record<string, string>)[column] ?? ''));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
