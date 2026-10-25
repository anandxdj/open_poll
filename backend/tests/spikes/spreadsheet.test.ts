import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';

/**
 * W2-C / W3-E spike: exceljs writes and reads XLSX (buffered and streamed)
 * and papaparse round-trips CSV, under Bun.
 */
const HEADER = ['Question', 'Option', 'Votes'];
const ROWS: Array<[string, string, number]> = [
  ['Best runtime?', 'Bun', 12],
  ['Best runtime?', 'Node', 7],
];

const readRows = async (buffer: ArrayBuffer | Buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheet = workbook.getWorksheet('Results');
  const rows: unknown[][] = [];
  sheet?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
};

describe('spike: exceljs', () => {
  it('round-trips a workbook through a buffer', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Results');
    sheet.addRow(HEADER).font = { bold: true };
    for (const row of ROWS) sheet.addRow(row);
    sheet.getCell('D2').value = { formula: 'C2*2', result: 24 };

    const rows = await readRows(await workbook.xlsx.writeBuffer());
    expect(rows[0]).toEqual(HEADER);
    expect(rows.slice(1).map((row) => row.slice(0, 3))).toEqual(ROWS);
    expect(rows[1]?.[3]).toEqual({ formula: 'C2*2', result: 24 });
  });

  it('streams a workbook with WorkbookWriter', async () => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useSharedStrings: false, useStyles: false });
    const sheet = writer.addWorksheet('Results');
    sheet.addRow(HEADER).commit();
    for (const row of ROWS) sheet.addRow(row).commit();
    sheet.commit();
    await writer.commit();

    expect(await readRows(Buffer.concat(chunks))).toEqual([HEADER, ...ROWS]);
  });
});

describe('spike: papaparse', () => {
  it('parses and unparses CSV with headers, quotes and a BOM', () => {
    const csv = '﻿question,options,correct\n"Pick one, please",A|B,1\nSecond,C|D,0\n';
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data).toEqual([
      { question: 'Pick one, please', options: 'A|B', correct: '1' },
      { question: 'Second', options: 'C|D', correct: '0' },
    ]);
    expect(Papa.unparse(parsed.data)).toBe('question,options,correct\r\n"Pick one, please",A|B,1\r\nSecond,C|D,0');
  });
});
