import type { PDFDocumentProxy } from 'unpdf/pdfjs';
import { ImportError } from '../errors';
import { IMPORT_LIMITS } from '../limits';
import { oneLine } from '../text';

/**
 * PDF reading through unpdf (pdf.js) and @napi-rs/canvas: page count, the
 * text of a page and a page rendered as PNG. One document handle is shared by
 * every call, so a 50-page file is parsed once.
 *
 * Hostile-input settings: no `eval` for font programs, a cap on decoded image
 * size, a page-size cap, and a timeout per page (a page that never finishes
 * rendering fails the job instead of hanging the worker).
 */

export interface PdfLimits {
  maxPages: number;
  maxRenderPx: number;
  renderScale: number;
  maxPagePoints: number;
  /** Time allowed for one page to render. */
  pageTimeoutMs: number;
}

export const DEFAULT_PDF_LIMITS: PdfLimits = { ...IMPORT_LIMITS.pdf, pageTimeoutMs: 30_000 };

export interface RenderedPage {
  number: number;
  png: Uint8Array;
  /** Page size in PDF points. */
  width: number;
  height: number;
}

export const invalidPdf = (detail?: string) =>
  new ImportError(
    'INVALID_PDF',
    `This file could not be read as a PDF${detail ? ` (${detail})` : ''}. Export it again from the program that made it and retry.`,
  );

const encryptedPdf = () =>
  new ImportError('PDF_ENCRYPTED', 'This PDF is password protected. Remove the password and try again.');

const withTimeout = <T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const isPasswordError = (error: unknown) => (error as { name?: string } | null)?.name === 'PasswordException';

export class PdfReader {
  private constructor(
    private readonly pdf: PDFDocumentProxy,
    private readonly limits: PdfLimits,
  ) {}

  /** Opens `data` (copied: pdf.js may detach the buffer it is given). */
  static async open(data: Uint8Array, limits: PdfLimits = DEFAULT_PDF_LIMITS): Promise<PdfReader> {
    const head = Buffer.from(data.subarray(0, Math.min(data.length, 1024))).toString('latin1');
    if (!head.includes('%PDF-')) throw invalidPdf('it does not look like a PDF');
    const { getDocumentProxy } = await import('unpdf');
    try {
      const options = { isEvalSupported: false, maxImageSize: 36_000_000, verbosity: 0 } as Parameters<
        typeof getDocumentProxy
      >[1];
      const pdf = await getDocumentProxy(new Uint8Array(data), options);
      return new PdfReader(pdf, limits);
    } catch (error) {
      if (isPasswordError(error)) throw encryptedPdf();
      throw invalidPdf('the document structure is damaged');
    }
  }

  get pageCount(): number {
    return this.pdf.numPages;
  }

  /** The document's Title property, if it has one. */
  async title(): Promise<string | null> {
    try {
      const { info } = await this.pdf.getMetadata();
      const title = (info as { Title?: unknown } | null)?.Title;
      return typeof title === 'string' && oneLine(title) ? oneLine(title) : null;
    } catch {
      return null;
    }
  }

  /** Plain text of one page, one line per text line. */
  async pageText(number: number): Promise<string> {
    const page = await this.pdf.getPage(number);
    const content = await page.getTextContent();
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      if (item.hasEOL) text += '\n';
    }
    return text
      .split('\n')
      .map((line) => oneLine(line))
      .filter(Boolean)
      .join('\n');
  }

  /**
   * One page as PNG. Scaled to `renderScale`, lowered so neither side passes
   * `maxRenderPx`. Throws an ImportError for a page that is implausibly large.
   */
  async renderPage(number: number): Promise<RenderedPage> {
    const page = await this.pdf.getPage(number);
    const { width, height } = page.getViewport({ scale: 1 });
    if (!(width > 0 && height > 0) || Math.max(width, height) > this.limits.maxPagePoints) {
      throw new ImportError('PDF_PAGE_TOO_LARGE', `Page ${number} has an unusable page size.`);
    }
    const scale = Math.min(this.limits.renderScale, this.limits.maxRenderPx / Math.max(width, height));
    const { renderPageAsImage } = await import('unpdf');
    const png = await withTimeout(
      renderPageAsImage(this.pdf, number, { canvasImport: () => import('@napi-rs/canvas'), scale }),
      this.limits.pageTimeoutMs,
      () => new ImportError('PDF_RENDER_TIMEOUT', `Page ${number} took too long to render.`),
    ).catch((error: unknown) => {
      if (error instanceof ImportError) throw error;
      throw new ImportError('PDF_RENDER_FAILED', `Page ${number} could not be rendered.`);
    });
    return { number, png: new Uint8Array(png), width, height };
  }

  async close(): Promise<void> {
    await this.pdf.loadingTask.destroy().catch(() => {});
  }
}
