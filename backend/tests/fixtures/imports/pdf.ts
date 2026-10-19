import PDFDocument from 'pdfkit';

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

export interface PdfPageSpec {
  title: string;
  body?: string;
}

/** A PDF with one page per spec (A6), written with pdfkit; page 1 also has a red square at (24, 200) 60pt wide. */
export async function buildPdf(pages: PdfPageSpec[], options: { size?: [number, number] | string; password?: string } = {}): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: (options.size ?? 'A6') as never,
    margin: 24,
    ...(options.password ? { userPassword: options.password, ownerPassword: `${options.password}-owner` } : {}),
    info: { Title: 'OpenPoll import fixture', CreationDate: FIXED_DATE, ModDate: FIXED_DATE },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Uint8Array>((resolve) => doc.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks)))));
  pages.forEach((page, index) => {
    if (index > 0) doc.addPage();
    doc.fillColor('#000000').fontSize(18).text(page.title);
    if (page.body) doc.fontSize(11).text(page.body);
    if (index === 0) doc.rect(24, 200, 60, 60).fill('#ff0000');
  });
  if (pages.length === 0) doc.text('');
  doc.end();
  return done;
}
