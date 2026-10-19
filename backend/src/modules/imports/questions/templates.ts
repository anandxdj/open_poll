import Papa from 'papaparse';
import { COLUMN_HELP, EXAMPLE_ROWS, QUESTION_TYPES, TEMPLATE_COLUMNS } from './columns';

/**
 * The downloadable templates (`GET /api/imports/templates/questions.csv|xlsx`):
 * the header row, one example per question type and, in the workbook, an
 * Instructions sheet and a drop-down on the `type` column.
 */

const exampleCells = (row: (typeof EXAMPLE_ROWS)[number]) => TEMPLATE_COLUMNS.map((column) => row[column] ?? '');

/** UTF-8 with a BOM (Excel then reads accents correctly). Cells that could run as formulas are escaped. */
export function questionsTemplateCsv(): string {
  const csv = Papa.unparse(
    { fields: [...TEMPLATE_COLUMNS], data: EXAMPLE_ROWS.map(exampleCells) },
    { newline: '\r\n', escapeFormulae: true },
  );
  return `﻿${csv}\r\n`;
}

export async function questionsTemplateXlsx(): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OpenPoll';
  const sheet = workbook.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = TEMPLATE_COLUMNS.map((column) => ({
    header: column,
    key: column,
    width: column === 'question' ? 48 : column.startsWith('option_') ? 18 : column === 'notes' || column === 'explanation' ? 32 : 16,
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of EXAMPLE_ROWS) sheet.addRow(exampleCells(row));
  for (let r = 2; r <= 300; r++) {
    sheet.getCell(r, 1).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${QUESTION_TYPES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Question type',
      error: `Use one of: ${QUESTION_TYPES.join(', ')}`,
    };
  }
  const help = workbook.addWorksheet('Instructions');
  help.columns = [{ width: 24 }, { width: 110 }];
  help.addRow(['Column', 'What to enter']).font = { bold: true };
  for (const [column, text] of COLUMN_HELP) help.addRow([column, text]);
  help.addRow([]);
  help.addRow(['Rules', 'One question per row, up to 50 rows. Rows with a problem are skipped and listed so you can fix them. Keep the header row.']);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
