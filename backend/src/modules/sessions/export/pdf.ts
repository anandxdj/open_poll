import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import { answeredCountOf, summaryOf, type ExportContext } from './context';
import type { DistributionSummary } from './summary';

/**
 * A printable session report: title, key numbers, one results chart per
 * response slide (horizontal bars from the slide's summary rows) and the top
 * of the leaderboard. Uses pdfkit's built-in Helvetica (WinAnsi), so
 * characters outside it (emoji, CJK) print as "?".
 */

// WinAnsi characters outside Latin-1 that the standard fonts can print.
const WIN_ANSI_EXTRAS = new Set(Array.from('ŒœŠšŸŽžƒˆ˜–—‘’‚“”„†‡•…‰‹›€™'));

/** Text the standard PDF fonts can draw: unsupported characters become "?". */
export const pdfText = (value: string) =>
  Array.from(value)
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(ch)) {
        return ch;
      }
      return '?';
    })
    .join('');

const COLORS = { text: '#111827', muted: '#6b7280', track: '#f3f4f6', bar: '#f59e0b', correct: '#10b981', rule: '#e5e7eb' };

const formatDate = (date: Date) => date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const formatValue = (unit: DistributionSummary['unit'], value: number) =>
  unit === 'average' ? value.toFixed(2) : String(Math.round(value));

export const writePdf = async (res: Response, ctx: ExportContext) => {
  const { session } = ctx;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: { Title: pdfText(`${ctx.title} - session ${session.runNumber}`), Creator: 'Open Poll' },
  });
  const finished = new Promise<void>((resolve, reject) => {
    res.on('finish', resolve);
    res.on('close', resolve);
    res.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  // --- Header ---
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(20).text(pdfText(ctx.title), { width });
  const meta = [
    `Session ${session.runNumber}`,
    formatDate(session.startedAt),
    session.endedAt ? formatDuration(session.endedAt.getTime() - session.startedAt.getTime()) : 'still live',
  ];
  doc.moveDown(0.2).font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(meta.join('  ·  '));

  // --- Key numbers ---
  const responses = ctx.slides.reduce((sum, slide) => sum + answeredCountOf(ctx, slide), 0);
  const possible = ctx.participants.length * ctx.slides.length;
  const stats: [string, string][] = [
    ['Participants', String(ctx.participants.length)],
    ['Responses', String(responses)],
    ['Response slides', String(ctx.slides.length)],
    ['Participation', possible > 0 ? `${Math.round((responses / possible) * 100)}%` : '-'],
  ];
  doc.moveDown(1);
  const statTop = doc.y;
  const statWidth = width / stats.length;
  stats.forEach(([label, value], i) => {
    const x = left + i * statWidth;
    doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.text).text(value, x, statTop, { width: statWidth - 10 });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(label.toUpperCase(), x, statTop + 24, {
      width: statWidth - 10,
    });
  });
  doc.x = left;
  doc.y = statTop + 48;
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(COLORS.rule).lineWidth(1).stroke();
  doc.moveDown(1);

  // --- One chart per response slide ---
  const labelWidth = Math.round(width * 0.4);
  const valueWidth = 50;
  const barX = left + labelWidth + 10;
  const barWidth = width - labelWidth - 10 - valueWidth - 10;
  const rowHeight = 16;

  if (ctx.slides.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted).text('No response slides were shown in this session.');
  }
  for (const slide of ctx.slides) {
    const summary = await summaryOf(ctx, slide);
    ensureSpace(60 + Math.min(summary.rows.length, 3) * rowHeight);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(COLORS.text)
      .text(pdfText(`${slide.slideIndex + 1}. ${slide.label}`), left, doc.y, { width });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(pdfText(`${slide.typeName}  ·  ${answeredCountOf(ctx, slide)} responses`), { width });
    doc.moveDown(0.5);

    if (summary.rows.length === 0) {
      doc.fontSize(10).fillColor(COLORS.muted).text('No responses.', { width });
    }
    const max = summary.max ?? Math.max(1, ...summary.rows.map((row) => row.value));
    for (const row of summary.rows) {
      ensureSpace(rowHeight);
      const y = doc.y;
      doc
        .font(row.highlight ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .fillColor(row.highlight ? COLORS.correct : COLORS.text)
        .text(pdfText(row.label || '-'), left, y + 2, { width: labelWidth, height: rowHeight, ellipsis: true, lineBreak: false });
      doc.rect(barX, y + 3, barWidth, 9).fill(COLORS.track);
      const filled = max > 0 ? Math.max(0, Math.min(1, row.value / max)) * barWidth : 0;
      if (filled > 0) doc.rect(barX, y + 3, filled, 9).fill(row.highlight ? COLORS.correct : COLORS.bar);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(COLORS.text)
        .text(formatValue(summary.unit, row.value), barX + barWidth + 10, y + 2, {
          width: valueWidth,
          align: 'right',
          lineBreak: false,
        });
      doc.x = left;
      doc.y = y + rowHeight;
    }
    doc.moveDown(1);
  }

  // --- Leaderboard ---
  const top = ctx.participants.slice(0, 10);
  if (top.length > 0) {
    ensureSpace(60 + top.length * rowHeight);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text).text('Leaderboard', left, doc.y, { width });
    doc.moveDown(0.5);
    for (const participant of top) {
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text(`#${participant.rank}`, left, y, { width: 30 });
      doc
        .fillColor(COLORS.text)
        .text(pdfText(participant.name), left + 35, y, { width: width - 170, ellipsis: true, lineBreak: false });
      doc.text(`${participant.score} pts`, left + width - 130, y, { width: 70, align: 'right', lineBreak: false });
      doc
        .fillColor(COLORS.muted)
        .text(`${participant.correctCount} correct`, left + width - 60, y, { width: 60, align: 'right', lineBreak: false });
      doc.x = left;
      doc.y = y + rowHeight;
    }
  }

  doc.end();
  await finished;
};
