import type { Response } from 'express';

/** Response helpers shared by the CSV, XLSX and PDF exports. */

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** `my-deck-run-3.csv`: ASCII, lower case, safe in any file system. */
export const exportFileName = (title: string, runNumber: number, format: ExportFormat) => {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session';
  return `${slug}-run-${runNumber}.${format}`;
};

/** Download headers. The file name is ASCII, so `filename` needs no extended form. */
export const setAttachmentHeaders = (res: Response, format: ExportFormat, fileName: string) => {
  res.status(200);
  res.setHeader('Content-Type', CONTENT_TYPES[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  // The browser client reads the file name from the header (cross-origin API).
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

/** Writes a chunk and waits for `drain` when the socket buffer is full (backpressure). */
export const writeChunk = (res: Response, chunk: string): Promise<void> => {
  if (res.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Client closed the export download'));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    res.on('drain', onDrain);
    res.on('close', onClose);
    res.on('error', onError);
  });
};
