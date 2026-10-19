import type { SlideDistribution } from '../../presentations/live/contract';
import { formatAnswer, type ExportSlide, type StoredAnswer } from './rows';

/**
 * Flat summaries of a slide's results for spreadsheets and the PDF: label →
 * value rows. The known results shapes (`kind`) of the built-in types read
 * their distribution; any other type falls back to a tally of its formatted
 * answers, so new types still get a summary.
 */

export interface SummaryRow {
  label: string;
  value: number;
  /** A correct option / accepted answer. */
  highlight: boolean;
}

export interface DistributionSummary {
  /** What `value` counts. */
  unit: 'responses' | 'average' | 'points';
  /** Scale maximum for averages (bars are drawn against it); null = largest value. */
  max: number | null;
  rows: SummaryRow[];
}

const MAX_ROWS = 20;

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : [];
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));

/** Summary of a known results shape, or null when `kind` is not one this module knows. */
export const summarizeDistribution = (distribution: SlideDistribution | null | undefined): DistributionSummary | null => {
  if (!distribution || typeof distribution !== 'object') return null;
  const d = distribution as Record<string, unknown>;
  switch (d.kind) {
    case 'options': {
      const counts = Array.isArray(d.counts) ? d.counts : [];
      return {
        unit: 'responses',
        max: null,
        rows: list(d.options).map((option, i) => ({
          label: str(option.text),
          value: num(counts[i]),
          highlight: option.isCorrect === true,
        })),
      };
    }
    case 'text':
      return {
        unit: 'responses',
        max: null,
        rows: list(d.answers)
          .slice(0, MAX_ROWS)
          .map((a) => ({ label: str(a.text), value: num(a.count), highlight: a.isCorrect === true })),
      };
    case 'words':
      return {
        unit: 'responses',
        max: null,
        rows: list(d.words)
          .slice(0, MAX_ROWS)
          .map((w) => ({ label: str(w.text), value: num(w.count), highlight: false })),
      };
    case 'responses':
      return {
        unit: 'responses',
        max: null,
        rows: list(d.responses)
          .slice(0, MAX_ROWS)
          .map((r) => ({ label: str(r.text), value: num(r.count), highlight: false })),
      };
    case 'scales':
      return {
        unit: 'average',
        max: num(d.scaleMax) || null,
        rows: list(d.statements).map((s) => ({ label: str(s.statement), value: num(s.average), highlight: false })),
      };
    case 'ranking':
      return {
        unit: 'points',
        max: null,
        rows: list(d.items).map((item) => ({ label: str(item.text), value: num(item.points), highlight: false })),
      };
    default:
      return null;
  }
};

/** Tally of formatted answers (most frequent first): the summary of a type with an unknown results shape. */
export const tallyAnswers = (slide: ExportSlide, answers: StoredAnswer[]): DistributionSummary => {
  const counts = new Map<string, number>();
  for (const answer of answers) {
    const text = formatAnswer(slide, answer);
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return {
    unit: 'responses',
    max: null,
    rows: [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_ROWS)
      .map(([label, value]) => ({ label, value, highlight: false })),
  };
};

/** The correct answer as text, read from a results payload; null when the shape carries none. */
export const correctAnswerOf = (distribution: SlideDistribution | null | undefined): string | null => {
  if (!distribution || typeof distribution !== 'object') return null;
  const d = distribution as Record<string, unknown>;
  if (d.kind === 'options') {
    const correct = list(d.options).filter((o) => o.isCorrect === true).map((o) => str(o.text));
    return correct.length ? correct.join(', ') : null;
  }
  if (d.kind === 'text') {
    const accepted = Array.isArray(d.acceptedAnswers) ? d.acceptedAnswers.map(str).filter(Boolean) : [];
    return accepted.length ? accepted.join(' / ') : null;
  }
  return null;
};
