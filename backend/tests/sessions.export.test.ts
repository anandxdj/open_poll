import { afterEach, describe, expect, it } from 'bun:test';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { csvField, csvLine } from '../src/modules/sessions/export/csv';
import type { ExportContext } from '../src/modules/sessions/export/context';
import { writePdf, pdfText } from '../src/modules/sessions/export/pdf';
import {
  exportSlideOf,
  formatAnswer,
  matrixHeaders,
  matrixRow,
  neutralizeFormula,
  responseRow,
  RESPONSE_HEADERS,
  type ExportSlide,
  type RankedParticipant,
  type StoredAnswer,
} from '../src/modules/sessions/export/rows';
import { exportFileName, setAttachmentHeaders, writeChunk } from '../src/modules/sessions/export/stream';
import { correctAnswerOf, summarizeDistribution, tallyAnswers } from '../src/modules/sessions/export/summary';
import { xlsxValue } from '../src/modules/sessions/export/xlsx';
import { commonSlideShape, defineSlideType, registerSlideType } from '../src/modules/presentations/slides';

/**
 * The export layer without a database: cell rendering, formula-injection
 * safety, registry-driven columns (a type registered later exports with no
 * change here), result summaries and the PDF writer.
 */

const participant = (overrides: Partial<RankedParticipant> = {}): RankedParticipant => ({
  participantId: 'p1',
  name: 'Ada',
  rank: 1,
  score: 900,
  correctCount: 1,
  joinedAt: new Date('2026-03-02T09:00:00Z'),
  kicked: false,
  ...overrides,
});

const answer = (overrides: Partial<StoredAnswer> = {}): StoredAnswer => ({
  participantId: 'p1',
  slideId: 's1',
  optionIndex: 0,
  text: null,
  payload: null,
  isCorrect: true,
  score: 900,
  timeMs: 4250,
  createdAt: new Date('2026-03-02T09:01:00Z'),
  ...overrides,
});

const selectSlide = (index = 0) =>
  exportSlideOf(
    {
      _id: 's1',
      type: 'select_answer',
      question: 'Capital of France?',
      options: [
        { text: 'Paris', isCorrect: true },
        { text: 'Lyon', isCorrect: false },
      ],
    } as never,
    index
  );

describe('formula neutralization', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd'])('prefixes %j so it stays text', (value) => {
    expect(neutralizeFormula(value)).toBe(`'${value}`);
  });

  it.each(['Paris', '', 'a=b', "'=safe", '1+1', 'x@y.z'])('leaves %j alone', (value) => {
    expect(neutralizeFormula(value)).toBe(value);
  });

  it('applies to CSV text cells but never to numbers', () => {
    expect(csvField('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvField(-5)).toBe('-5');
    expect(csvField(0.5)).toBe('0.5');
  });

  it('applies to XLSX text cells but never to numbers', () => {
    expect(xlsxValue('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(xlsxValue(-3)).toBe(-3);
    expect(xlsxValue(null)).toBeNull();
    expect(xlsxValue(Number.NaN)).toBeNull();
  });
});

describe('CSV encoding', () => {
  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('plain')).toBe('plain');
  });

  it('writes null, undefined and non-finite numbers as empty fields', () => {
    expect(csvLine(['a', null, undefined, Number.POSITIVE_INFINITY, 3])).toBe('a,,,,3\r\n');
  });

  it('quotes after neutralizing, so a formula with a comma is one safe field', () => {
    expect(csvField('=A1,B1')).toBe(`"'=A1,B1"`);
  });
});

describe('export file names and headers', () => {
  it('slugs the title to safe ASCII with the run number', () => {
    expect(exportFileName('Q3 All-Hands: Café "Quiz"!', 4, 'csv')).toBe('q3-all-hands-cafe-quiz-run-4.csv');
    expect(exportFileName('日本語', 1, 'pdf')).toBe('session-run-1.pdf');
    expect(exportFileName('', 2, 'xlsx')).toBe('session-run-2.xlsx');
    expect(exportFileName('a'.repeat(200), 1, 'csv').length).toBeLessThan(80);
  });

  it('sets download headers that forbid caching and sniffing', () => {
    const headers: Record<string, string> = {};
    const res = {
      status: () => res,
      setHeader: (name: string, value: string) => void (headers[name.toLowerCase()] = value),
    };
    setAttachmentHeaders(res as never, 'xlsx', 'deck-run-1.xlsx');
    expect(headers['content-type']).toContain('spreadsheetml');
    expect(headers['content-disposition']).toBe('attachment; filename="deck-run-1.xlsx"');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['access-control-expose-headers']).toBe('Content-Disposition');
  });

  it('waits for drain under backpressure and rejects when the client goes away', async () => {
    const written: string[] = [];
    const slow = new Writable({
      highWaterMark: 4,
      write(chunk, _enc, cb) {
        written.push(String(chunk));
        setTimeout(cb, 5);
      },
    });
    await writeChunk(slow as never, 'abcdefgh');
    await writeChunk(slow as never, 'ij');
    expect(written.join('')).toBe('abcdefghij');

    const closing = new Writable({ highWaterMark: 1, write: () => {} });
    const pending = writeChunk(closing as never, 'xxxxxxxx');
    closing.emit('close');
    await expect(pending).rejects.toThrow('closed');
  });
});

describe('registry-driven columns', () => {
  it('uses each built-in type\'s export columns and cells', () => {
    const slide = selectSlide();
    expect(slide.columns).toEqual(['Capital of France?']);
    expect(slide.cells({ optionIndex: 1, text: null, payload: null, isCorrect: false, score: 0 })).toEqual(['Lyon']);
    expect(slide.cells(null)).toEqual([null]);

    const scales = exportSlideOf(
      { _id: 's2', type: 'scales', question: 'Rate', statements: ['Pace', 'Clarity'] } as never,
      1
    );
    expect(scales.columns).toEqual(['Rate — Pace', 'Rate — Clarity']);
    expect(scales.cells({ optionIndex: null, text: null, payload: { ratings: [4, 5] }, isCorrect: false, score: 0 })).toEqual([4, 5]);
  });

  it('formats an answer as one text cell, naming the statement for multi-column types', () => {
    const scales = exportSlideOf(
      { _id: 's2', type: 'scales', question: 'Rate', statements: ['Pace', 'Clarity'] } as never,
      1
    );
    const rated = answer({ optionIndex: null, payload: { ratings: [4, 5] } });
    expect(formatAnswer(scales, rated)).toBe('Pace: 4; Clarity: 5');
    expect(formatAnswer(selectSlide(), answer())).toBe('Paris');
    expect(formatAnswer(selectSlide(), null)).toBeNull();
  });

  describe('a type registered later', () => {
    let unregister: (() => void) | null = null;
    afterEach(() => unregister?.());

    const futureType = (withExport: boolean) =>
      defineSlideType<never, never>({
        type: 'test_future',
        name: 'Future',
        kind: 'interactive',
        lifecycle: 'response',
        scored: false,
        schema: z.object({ type: z.literal('test_future'), ...commonSlideShape }),
        sanitize: (slide) => ({ question: slide.question }),
        label: (slide) => slide.question || 'Future',
        ...(withExport
          ? {
              exportColumns: () => ['Pin x', 'Pin y'],
              exportCells: (_slide, a) => {
                const p = a?.payload as { x: number; y: number } | null | undefined;
                return [p?.x ?? null, p?.y ?? null];
              },
            }
          : {}),
      });

    it('exports through its own exportColumns/exportCells with no change here', () => {
      unregister = registerSlideType(futureType(true));
      const slide = exportSlideOf({ _id: 'f1', type: 'test_future', question: 'Where?' } as never, 3);
      expect(slide.columns).toEqual(['Pin x', 'Pin y']);
      expect(slide.typeName).toBe('Future');
      const a = answer({ optionIndex: null, payload: { x: 0.25, y: 0.75 } });
      expect(slide.cells(a)).toEqual([0.25, 0.75]);
      expect(responseRow(participant(), slide, a)[8]).toBe('Pin x: 0.25; Pin y: 0.75');
      expect(matrixHeaders([slide]).slice(4)).toEqual(['4. Pin x', '4. Pin y']);
      expect(matrixRow(participant(), [slide], new Map([['f1', a]])).slice(4)).toEqual([0.25, 0.75]);
    });

    it('falls back to the stored text, option or payload for a type without hooks', () => {
      unregister = registerSlideType(futureType(false));
      const slide = exportSlideOf({ _id: 'f2', type: 'test_future', question: 'Where?' } as never, 0);
      expect(slide.columns).toEqual(['Where?']);
      expect(slide.cells(answer({ optionIndex: null, text: 'hello' }))).toEqual(['hello']);
      expect(slide.cells(answer({ optionIndex: 2, text: null }))).toEqual([2]);
      expect(slide.cells(answer({ optionIndex: null, payload: { a: 1 } }))).toEqual(['{"a":1}']);
      expect(slide.cells(null)).toEqual([null]);
    });

    it('survives a type that is no longer registered', () => {
      const slide = exportSlideOf({ _id: 'gone', type: 'removed_type', question: '' } as never, 0);
      expect(slide).toMatchObject({ type: 'removed_type', typeName: 'removed_type', label: 'removed_type' });
      expect(slide.cells(answer({ optionIndex: null, text: 'x' }))).toEqual(['x']);
    });

    it('pads or trims cells so every row lines up with the header', () => {
      unregister = registerSlideType({
        ...futureType(true),
        exportCells: () => ['only one'],
      } as never);
      const slide = exportSlideOf({ _id: 'f3', type: 'test_future', question: 'Where?' } as never, 0);
      expect(slide.cells(answer())).toEqual(['only one', null]);
    });
  });
});

describe('row layouts', () => {
  it('responseRow lines up with RESPONSE_HEADERS and scores only scored slides', () => {
    const slide = selectSlide(2);
    const row = responseRow(participant({ name: '=evil' }), slide, answer());
    expect(row).toHaveLength(RESPONSE_HEADERS.length);
    expect(row.slice(0, 8)).toEqual([1, '=evil', 'p1', 900, 3, 'Select answer', 'Capital of France?', 'yes']);
    expect(row.slice(8)).toEqual(['Paris', 'yes', 900, 4.3, '2026-03-02T09:01:00.000Z']);

    const skipped = responseRow(participant(), slide, null);
    expect(skipped.slice(7)).toEqual(['no', null, null, null, null, null]);

    const unscored = { ...slide, scored: false };
    expect(responseRow(participant(), unscored, answer()).slice(9, 11)).toEqual([null, null]);
  });
});

describe('result summaries', () => {
  it('reads every built-in results shape', () => {
    expect(
      summarizeDistribution({
        kind: 'options',
        counts: [3, 1],
        options: [
          { text: 'Paris', isCorrect: true },
          { text: 'Lyon', isCorrect: false },
        ],
      })
    ).toEqual({
      unit: 'responses',
      max: null,
      rows: [
        { label: 'Paris', value: 3, highlight: true },
        { label: 'Lyon', value: 1, highlight: false },
      ],
    });
    expect(summarizeDistribution({ kind: 'words', words: [{ text: 'sun', count: 4 }] })?.rows).toEqual([
      { label: 'sun', value: 4, highlight: false },
    ]);
    expect(summarizeDistribution({ kind: 'text', answers: [{ text: 'Jupiter', count: 5, isCorrect: true }] })?.rows[0]).toEqual({
      label: 'Jupiter',
      value: 5,
      highlight: true,
    });
    expect(summarizeDistribution({ kind: 'scales', scaleMax: 5, statements: [{ statement: 'Pace', average: 3.5 }] })).toMatchObject({
      unit: 'average',
      max: 5,
      rows: [{ label: 'Pace', value: 3.5 }],
    });
    expect(summarizeDistribution({ kind: 'ranking', items: [{ text: 'A', points: 9 }] })).toMatchObject({ unit: 'points' });
    expect(summarizeDistribution({ kind: 'responses', responses: [{ text: 'nice', count: 2 }] })?.rows).toHaveLength(1);
  });

  it('returns null for unknown shapes so the caller can tally answers', () => {
    expect(summarizeDistribution({ kind: 'something_new' })).toBeNull();
    expect(summarizeDistribution({})).toBeNull();
    expect(summarizeDistribution(null)).toBeNull();
    expect(summarizeDistribution(undefined)).toBeNull();
  });

  it('caps long lists and tolerates malformed payloads', () => {
    const words = Array.from({ length: 50 }, (_, i) => ({ text: `w${i}`, count: 50 - i }));
    expect(summarizeDistribution({ kind: 'words', words })?.rows).toHaveLength(20);
    expect(summarizeDistribution({ kind: 'options', counts: 'x', options: [null, 3, { text: 5 }] })?.rows).toEqual([
      { label: '5', value: 0, highlight: false },
    ]);
  });

  it('tallies formatted answers, most frequent first', () => {
    const slide = selectSlide();
    const tally = tallyAnswers(slide, [
      answer({ optionIndex: 0 }),
      answer({ optionIndex: 1 }),
      answer({ optionIndex: 1 }),
      answer({ optionIndex: null }),
    ]);
    expect(tally.rows).toEqual([
      { label: 'Lyon', value: 2, highlight: false },
      { label: 'Paris', value: 1, highlight: false },
    ]);
  });

  it('reads the correct answer from options and type_answer results only', () => {
    expect(
      correctAnswerOf({ kind: 'options', options: [{ text: 'A', isCorrect: true }, { text: 'B', isCorrect: true }, { text: 'C', isCorrect: false }] })
    ).toBe('A, B');
    expect(correctAnswerOf({ kind: 'text', acceptedAnswers: ['Jupiter', 'jupiter planet'] })).toBe('Jupiter / jupiter planet');
    expect(correctAnswerOf({ kind: 'options', options: [{ text: 'A', isCorrect: false }] })).toBeNull();
    expect(correctAnswerOf({ kind: 'words', words: [] })).toBeNull();
    expect(correctAnswerOf(null)).toBeNull();
  });
});

describe('PDF report', () => {
  it('maps characters the standard fonts cannot draw to "?"', () => {
    expect(pdfText('Café – “quoted” €5')).toBe('Café – “quoted” €5');
    expect(pdfText('rocket 🚀 日本')).toBe('rocket ? ??');
    expect(pdfText('line\nbreak')).toBe('line\nbreak');
  });

  const collect = () => {
    const chunks: Buffer[] = [];
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    return { res, bytes: () => Buffer.concat(chunks) };
  };

  const context = (slides: ExportSlide[], participants: RankedParticipant[]): ExportContext => ({
    session: {
      runNumber: 2,
      startedAt: new Date('2026-03-02T09:00:00Z'),
      endedAt: new Date('2026-03-02T09:42:00Z'),
    } as never,
    sessionId: 'sid',
    title: 'Quarterly 🚀 review',
    slides,
    participants,
    results: new Map(
      slides.map((slide) => [
        slide.slideId,
        {
          answeredCount: 3,
          distribution: {
            kind: 'options',
            counts: [2, 1],
            options: [
              { text: 'Paris', isCorrect: true },
              { text: 'Lyon', isCorrect: false },
            ],
          },
        },
      ])
    ),
    generatedAt: new Date('2026-03-02T10:00:00Z'),
  });

  it('writes a valid multi-page PDF without touching the database', async () => {
    const slides = Array.from({ length: 12 }, (_, i) => ({ ...selectSlide(i), slideId: `s${i}` }));
    const participants = Array.from({ length: 12 }, (_, i) => participant({ participantId: `p${i}`, name: `Player ${i} 日本`, rank: i + 1 }));
    const { res, bytes } = collect();
    await writePdf(res as never, context(slides, participants));
    const pdf = bytes();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
  });

  it('writes a report for a session without response slides or participants', async () => {
    const { res, bytes } = collect();
    await writePdf(res as never, context([], []));
    expect(bytes().subarray(0, 5).toString()).toBe('%PDF-');
  });
});
