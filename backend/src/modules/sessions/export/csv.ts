import type { Response } from 'express';
import type { ExportCell } from '../../presentations/slides';
import type { ExportContext } from './context';
import { neutralizeFormula, participantBatches, RESPONSE_HEADERS, responseRow } from './rows';
import { writeChunk } from './stream';

/** One CSV field (RFC 4180 quoting; text cells formula-neutralized). */
export const csvField = (value: ExportCell | undefined): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = neutralizeFormula(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const csvLine = (cells: readonly (ExportCell | undefined)[]) => `${cells.map(csvField).join(',')}\r\n`;

/**
 * Streams the "Responses" table: one row per participant × response slide,
 * participants in rank order. Starts with a BOM so Excel reads UTF-8.
 */
export const writeCsv = async (res: Response, ctx: ExportContext) => {
  await writeChunk(res, `﻿${csvLine(RESPONSE_HEADERS)}`);
  for await (const batch of participantBatches(ctx.sessionId, ctx.participants)) {
    let chunk = '';
    for (const participant of batch.participants) {
      const answers = batch.answers.get(participant.participantId);
      for (const slide of ctx.slides) {
        chunk += csvLine(responseRow(participant, slide, answers?.get(slide.slideId) ?? null));
      }
    }
    if (chunk) await writeChunk(res, chunk);
  }
  res.end();
};
