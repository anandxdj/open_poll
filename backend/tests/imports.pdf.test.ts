import { describe, expect, it } from 'bun:test';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { ImportError } from '../src/modules/imports/errors';
import { DEFAULT_PDF_LIMITS, PdfReader } from '../src/modules/imports/pdf/render';
import { SAMPLE_PDF } from './fixtures/import/constants';
import { buildPdf } from './fixtures/imports/pdf';

const sample = () =>
  buildPdf(SAMPLE_PDF.pages.map((page) => ({ title: page.title, body: page.body })));

const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe('pdf reader', () => {
  it('reads page count and per-page text', async () => {
    const reader = await PdfReader.open(await sample());
    try {
      expect(reader.pageCount).toBe(2);
      expect(await reader.pageText(1)).toContain(SAMPLE_PDF.pages[0].title);
      expect(await reader.pageText(1)).toContain(SAMPLE_PDF.pages[0].body);
      expect(await reader.pageText(2)).toBe(SAMPLE_PDF.pages[1].title);
    } finally {
      await reader.close();
    }
  });

  it('renders a page to PNG at the preferred scale and shows the drawn content', async () => {
    const reader = await PdfReader.open(await sample());
    try {
      const page = await reader.renderPage(1);
      expect(page.width).toBeCloseTo(SAMPLE_PDF.pageSize.width, 1);
      const scale = DEFAULT_PDF_LIMITS.renderScale;
      expect(pngSize(page.png)).toEqual({ width: Math.floor(page.width * scale), height: Math.floor(page.height * scale) });

      const image = await loadImage(Buffer.from(page.png));
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { x, y, size } = SAMPLE_PDF.redSquare;
      const [r, g, b] = ctx.getImageData((x + size / 2) * scale, (y + size / 2) * scale, 1, 1).data;
      expect([r, g, b]).toEqual([255, 0, 0]);
    } finally {
      await reader.close();
    }
  });

  it('lowers the scale so a large page stays within the pixel cap', async () => {
    const big = await buildPdf([{ title: 'Big' }], { size: [2000, 1000] });
    const reader = await PdfReader.open(big, { ...DEFAULT_PDF_LIMITS, maxRenderPx: 800 });
    try {
      const { png } = await reader.renderPage(1);
      expect(pngSize(png)).toEqual({ width: 800, height: 400 });
    } finally {
      await reader.close();
    }
  });

  it('refuses an implausibly large page', async () => {
    const huge = await buildPdf([{ title: 'Huge' }], { size: [20000, 100] });
    const reader = await PdfReader.open(huge);
    try {
      await expect(reader.renderPage(1)).rejects.toMatchObject({ code: 'PDF_PAGE_TOO_LARGE' });
    } finally {
      await reader.close();
    }
  });

  it('says so when a PDF is password protected', async () => {
    const locked = await buildPdf([{ title: 'Secret' }], { password: 'hunter2' });
    const error = await PdfReader.open(locked).catch((e: unknown) => e);
    expect((error as ImportError).code).toBe('PDF_ENCRYPTED');
  });

  it('rejects files that are not PDFs and damaged PDFs with a readable error', async () => {
    await expect(PdfReader.open(new TextEncoder().encode('hello world'))).rejects.toBeInstanceOf(ImportError);
    const damaged = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    const error = await PdfReader.open(damaged).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).code).toBe('INVALID_PDF');
  });
});
