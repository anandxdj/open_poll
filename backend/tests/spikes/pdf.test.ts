import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadImage } from '@napi-rs/canvas';
import PDFDocument from 'pdfkit';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import { SAMPLE_PDF } from '../fixtures/import/constants';

/**
 * W3-E / W2-C spike: unpdf renders PDF pages to PNG through @napi-rs/canvas,
 * and pdfkit writes PDFs, under Bun. pdf.js may detach the buffer it is
 * given, so every call gets a fresh copy.
 */
const samplePdf = readFileSync(`${import.meta.dir}/../fixtures/import/sample.pdf`);
const sample = () => new Uint8Array(samplePdf);

const pngSize = (png: Uint8Array) => {
  // Signature, then the IHDR chunk: width and height are big-endian at bytes 16 and 20.
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe('spike: unpdf + @napi-rs/canvas', () => {
  it('reads the page count and text of the fixture', async () => {
    const pdf = await getDocumentProxy(sample());
    expect(pdf.numPages).toBe(2);
    const { text } = await extractText(pdf, { mergePages: false });
    expect(text[0]).toContain(SAMPLE_PDF.pages[0].title);
    expect(text[0]).toContain(SAMPLE_PDF.pages[0].body);
    expect(text[1]).toContain(SAMPLE_PDF.pages[1].title);
  });

  it('renders page 1 to a PNG that shows the red square', async () => {
    const scale = 2;
    const png = new Uint8Array(
      await renderPageAsImage(sample(), 1, { canvasImport: () => import('@napi-rs/canvas'), scale }),
    );
    const { width, height } = pngSize(png);
    expect(width).toBe(Math.floor(SAMPLE_PDF.pageSize.width * scale));
    expect(height).toBe(Math.floor(SAMPLE_PDF.pageSize.height * scale));

    // Decode the PNG and sample the middle of the square drawn in the fixture.
    const { createCanvas } = await import('@napi-rs/canvas');
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { x, y, size } = SAMPLE_PDF.redSquare;
    const [r, g, b] = ctx.getImageData((x + size / 2) * scale, (y + size / 2) * scale, 1, 1).data;
    expect([r, g, b]).toEqual([255, 0, 0]);
  });
});

describe('spike: pdfkit', () => {
  it('writes a PDF that unpdf reads back', async () => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.fontSize(20).text('Session report');
    doc.fontSize(12).text('Answers: 42');
    doc.addPage().text('Leaderboard');
    doc.end();

    const pdf = await done;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const { totalPages, text } = await extractText(new Uint8Array(pdf), { mergePages: true });
    expect(totalPages).toBe(2);
    expect(text).toContain('Session report');
    expect(text).toContain('Answers: 42');
    expect(text).toContain('Leaderboard');
  });
});
