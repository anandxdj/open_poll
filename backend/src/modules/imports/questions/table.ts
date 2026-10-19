import Papa from 'papaparse';
import { ImportError } from '../errors';
import { IMPORT_LIMITS } from '../limits';
import { looksLikeZip } from '../bytes';
import { SafeZip, type ZipLimits } from '../zip';
import { stripControl } from '../text';

/**
 * A spreadsheet reduced to text: the first row is the header, every other row
 * a list of cell strings. Both readers return values only: a formula cell
 * yields its cached result, never its formula, and nothing is evaluated.
 */

export interface TableRow {
  /** 1-based row number as a spreadsheet shows it (the header is row 1). */
  row: number;
  cells: string[];
}

export interface Table {
  headers: string[];
  rows: TableRow[];
}

/** Scanned rows (blank or not): beyond this the file is not a question list. */
export const MAX_SCANNED_ROWS = 1000;
export const MAX_COLUMNS = 60;
/** Characters kept per cell; longer cells are cut (every field has a lower cap of its own). */
export const MAX_CELL_CHARS = 5000;

const notReadable = (kind: 'CSV' | 'Excel', detail: string) =>
  new ImportError('QUESTIONS_UNREADABLE', `This ${kind} file could not be read (${detail}). Download the template and try again.`);

const tooManyRows = () =>
  new ImportError('QUESTIONS_TOO_MANY_ROWS', `This file has more than ${MAX_SCANNED_ROWS} rows. A deck holds at most ${IMPORT_LIMITS.maxSlides} slides.`);

const cleanCell = (value: string) => stripControl(value).trim().slice(0, MAX_CELL_CHARS);

/** UTF-8 (with or without BOM), UTF-16 with BOM, else Windows-1252 as Excel writes it. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return Buffer.from(bytes.subarray(2)).toString('utf16le');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Header row + data rows from a grid of cells; trailing empty header cells are dropped, blank rows skipped. */
function toTable(grid: string[][], kind: 'CSV' | 'Excel'): Table {
  if (grid.length > MAX_SCANNED_ROWS) throw tooManyRows();
  const first = grid.findIndex((cells) => cells.some((cell) => cell !== ''));
  if (first < 0) throw notReadable(kind, 'it is empty');
  const headerCells = [...grid[first]!];
  while (headerCells.length > 0 && headerCells[headerCells.length - 1] === '') headerCells.pop();
  if (headerCells.length > MAX_COLUMNS) throw notReadable(kind, `more than ${MAX_COLUMNS} columns`);
  const rows: TableRow[] = [];
  for (let i = first + 1; i < grid.length; i++) {
    const cells = grid[i]!.slice(0, headerCells.length);
    if (cells.every((cell) => cell === '')) continue;
    rows.push({ row: i + 1, cells });
  }
  return { headers: headerCells, rows };
}

export function readCsv(bytes: Uint8Array): Table {
  const text = decodeText(bytes);
  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  // Row-level shape errors (too few fields) are fine: short rows are padded. Broken quoting is not.
  const fatal = result.errors.find((error) => error.type === 'Quotes');
  if (fatal) throw notReadable('CSV', `a quoted value is not closed near row ${(fatal.row ?? 0) + 1}`);
  const grid = result.data.map((cells) => cells.map((cell) => cleanCell(String(cell ?? ''))));
  // Papaparse reports one phantom empty record after a trailing newline.
  while (grid.length > 0 && grid[grid.length - 1]!.every((cell) => cell === '')) grid.pop();
  return toTable(grid, 'CSV');
}

/** A cell value as plain text: formulas by their cached result, rich text flattened, dates as ISO. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('error' in record) return '';
    if ('result' in record) return cellText(record.result);
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => String((part as { text?: unknown }).text ?? '')).join('');
    }
    if ('text' in record) return cellText(record.text);
  }
  return '';
}

export interface XlsxOptions {
  maxBytes?: number;
  zip?: ZipLimits;
}

const XLSX_ZIP_LIMITS: ZipLimits = {
  maxEntries: 500,
  maxTotalBytes: IMPORT_LIMITS.questions.maxXlsxUncompressedBytes,
  maxEntryBytes: IMPORT_LIMITS.questions.maxXlsxUncompressedBytes,
  maxRatio: IMPORT_LIMITS.zip.maxRatio,
  ratioFloorBytes: IMPORT_LIMITS.zip.ratioFloorBytes,
};

export async function readXlsx(bytes: Uint8Array, options: XlsxOptions = {}): Promise<Table> {
  if (!looksLikeZip(bytes)) throw notReadable('Excel', 'it is not an .xlsx workbook');
  // The archive is checked (entry count, expanded size, ratio, real sizes) and repacked: exceljs only ever
  // sees a copy whose declared sizes are true.
  const clean = SafeZip.open(bytes, (detail) => notReadable('Excel', detail), options.zip ?? XLSX_ZIP_LIMITS).repack();

  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(clean) as unknown as ArrayBuffer);
  } catch {
    throw notReadable('Excel', 'the workbook is damaged or not an .xlsx file');
  }
  const sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0);
  if (!sheet) throw notReadable('Excel', 'it has no data');
  if (sheet.rowCount > MAX_SCANNED_ROWS * 5) throw tooManyRows();

  const columnCount = Math.min(sheet.columnCount, MAX_COLUMNS + 1);
  const grid: string[][] = [];
  const lastRow = Math.min(sheet.rowCount, MAX_SCANNED_ROWS + 1);
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= columnCount; c++) cells.push(cleanCell(cellText(row.getCell(c).value)));
    grid.push(cells);
  }
  while (grid.length > 0 && grid[grid.length - 1]!.every((cell) => cell === '')) grid.pop();
  if (sheet.rowCount > lastRow) throw tooManyRows();
  return toTable(grid, 'Excel');
}
