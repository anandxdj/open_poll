import type { Response } from 'express';
import ExcelJS from 'exceljs';
import type { ExportCell } from '../../presentations/slides';
import { answeredCountOf, summaryOf, type ExportContext } from './context';
import {
  matrixHeaders,
  matrixRow,
  neutralizeFormula,
  participantBatches,
  RESPONSE_HEADERS,
  responseRow,
} from './rows';

/** A cell value for exceljs: numbers stay numbers, text is formula-neutralized. */
export const xlsxValue = (cell: ExportCell | undefined): string | number | null => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  return neutralizeFormula(String(cell));
};

const values = (cells: readonly (ExportCell | undefined)[]) => cells.map(xlsxValue);

type Sheet = ExcelJS.Worksheet;

const addHeader = (sheet: Sheet, cells: readonly string[]) => {
  const row = sheet.addRow(values(cells));
  row.font = { bold: true };
  row.commit();
};

const UNIT_LABEL = { responses: 'responses', average: 'average rating', points: 'points' } as const;

/**
 * Streams a workbook with four sheets, committed in order (the streaming
 * writer can only flush one sheet at a time):
 * - Summary — the session and one line per response slide;
 * - Results — each slide's results as label → value rows;
 * - Responses — one row per participant × response slide (same as the CSV);
 * - Participants — one row per participant, every slide's export columns.
 */
export const writeXlsx = async (res: Response, ctx: ExportContext) => {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  workbook.creator = 'Open Poll';
  workbook.created = ctx.generatedAt;
  const { session } = ctx;

  const summary = workbook.addWorksheet('Summary');
  const facts: [string, ExportCell][] = [
    ['Presentation', ctx.title],
    ['Session', session.runNumber],
    ['Status', session.status],
    ['Started', session.startedAt.toISOString()],
    ['Ended', session.endedAt ? session.endedAt.toISOString() : null],
    ['Participants', ctx.participants.length],
    ['Responses', ctx.slides.reduce((sum, slide) => sum + answeredCountOf(ctx, slide), 0)],
  ];
  for (const fact of facts) summary.addRow(values(fact)).commit();
  summary.addRow([]).commit();
  addHeader(summary, ['Slide', 'Type', 'Question', 'Responses']);
  for (const slide of ctx.slides) {
    summary.addRow(values([slide.slideIndex + 1, slide.typeName, slide.label, answeredCountOf(ctx, slide)])).commit();
  }
  summary.commit();

  const results = workbook.addWorksheet('Results');
  addHeader(results, ['Slide', 'Question', 'Result', 'Value', 'Measure', 'Correct']);
  for (const slide of ctx.slides) {
    const { unit, rows } = await summaryOf(ctx, slide);
    for (const row of rows) {
      results
        .addRow(values([slide.slideIndex + 1, slide.label, row.label, row.value, UNIT_LABEL[unit], row.highlight ? 'yes' : null]))
        .commit();
    }
  }
  results.commit();

  const responses = workbook.addWorksheet('Responses');
  addHeader(responses, RESPONSE_HEADERS);
  for await (const batch of participantBatches(ctx.sessionId, ctx.participants)) {
    for (const participant of batch.participants) {
      const answers = batch.answers.get(participant.participantId);
      for (const slide of ctx.slides) {
        responses.addRow(values(responseRow(participant, slide, answers?.get(slide.slideId) ?? null))).commit();
      }
    }
  }
  responses.commit();

  const matrix = workbook.addWorksheet('Participants');
  addHeader(matrix, matrixHeaders(ctx.slides));
  for await (const batch of participantBatches(ctx.sessionId, ctx.participants)) {
    for (const participant of batch.participants) {
      matrix.addRow(values(matrixRow(participant, ctx.slides, batch.answers.get(participant.participantId)))).commit();
    }
  }
  matrix.commit();

  await workbook.commit();
};
