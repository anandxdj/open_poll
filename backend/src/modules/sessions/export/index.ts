import type { Response } from 'express';
import type { AuthorizedSession } from '../sessions.access';
import { buildExportContext } from './context';
import { writeCsv } from './csv';
import { writePdf } from './pdf';
import { exportFileName, setAttachmentHeaders, type ExportFormat } from './stream';
import { writeXlsx } from './xlsx';

export type { ExportFormat } from './stream';

const WRITERS = { csv: writeCsv, xlsx: writeXlsx, pdf: writePdf } as const;

/**
 * Streams one export of an authorized session. Data loading happens before
 * the first byte, so lookup errors still reach the JSON error handler; a
 * failure mid-stream destroys the response (the download is cut short).
 */
export const streamSessionExport = async (res: Response, format: ExportFormat, { session, presentation }: AuthorizedSession) => {
  const ctx = await buildExportContext(session, presentation);
  setAttachmentHeaders(res, format, exportFileName(presentation.title, session.runNumber, format));
  try {
    await WRITERS[format](res, ctx);
  } catch (error) {
    if (!res.writableEnded) {
      console.error(`[Sessions] ${format.toUpperCase()} export failed mid-stream:`, error);
      res.destroy(error instanceof Error ? error : undefined);
    }
  }
};
