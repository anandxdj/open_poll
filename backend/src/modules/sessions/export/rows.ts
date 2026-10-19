import mongoose from 'mongoose';
import { PresentationAnswerModel } from '../../presentations/models/answer.model';
import { PresentationParticipantModel } from '../../presentations/models/participant.model';
import type { IPresentationSession } from '../../presentations/models/session.model';
import { getSlideType, isSlideScored, type ExportAnswer, type ExportCell, type Slide } from '../../presentations/slides';
import { lifecycleOf, readSlideState, sessionSlides, slideIdOf } from '../../presentations/live/state';

/**
 * Generic export model: the response slides a session ran and one row per
 * participant × slide, rendered through the slide registry's
 * `exportColumns`/`exportCells`. Nothing here switches on a slide type, so a
 * type registered later exports without changes.
 */

export interface ExportSlide {
  slideId: string;
  slideIndex: number;
  type: string;
  /** Registry name ("Select answer"), or the type key when unregistered. */
  typeName: string;
  label: string;
  scored: boolean;
  slide: Slide;
  /** The type's export columns (at least one). */
  columns: string[];
  /** The type's cells for one answer (null = not answered), one per column. */
  cells(answer: ExportAnswer | null): ExportCell[];
}

/** A stored answer as the exports read it. */
export interface StoredAnswer extends ExportAnswer {
  participantId: string;
  slideId: string;
  timeMs: number;
  createdAt: Date | null;
}

export interface RankedParticipant {
  participantId: string;
  name: string;
  rank: number;
  score: number;
  correctCount: number;
  joinedAt: Date;
  kicked: boolean;
}

/** Cell text for types without export hooks: the stored text, option index or JSON payload. */
const fallbackCell = (answer: ExportAnswer | null): ExportCell => {
  if (!answer) return null;
  if (typeof answer.text === 'string' && answer.text) return answer.text;
  if (typeof answer.optionIndex === 'number') return answer.optionIndex;
  if (answer.payload != null) {
    try {
      return JSON.stringify(answer.payload);
    } catch {
      return null;
    }
  }
  return null;
};

export const exportSlideOf = (slide: Slide, slideIndex: number): ExportSlide => {
  const def = getSlideType(slide.type);
  const label = (def ? def.label(slide) : slide.question?.trim()) || String(slide.type);
  const columns = def?.exportColumns?.(slide) ?? [];
  const usable = columns.length > 0 && typeof def?.exportCells === 'function';
  return {
    slideId: slideIdOf(slide),
    slideIndex,
    type: String(slide.type),
    typeName: def?.name ?? String(slide.type),
    label,
    scored: isSlideScored(slide),
    slide,
    columns: usable ? columns : [label],
    cells: (answer) => {
      if (!usable) return [fallbackCell(answer)];
      const cells = def!.exportCells!(slide, answer);
      // Pad or trim to the declared columns so rows always line up with the header.
      return columns.map((_, i) => cells[i] ?? null);
    },
  };
};

/**
 * Response slides the session ran, in deck order: those shown at least once
 * (a slide state) or with stored results (`slideStats`).
 */
export const exportSlidesOf = (session: IPresentationSession): ExportSlide[] => {
  const withStats = new Set((session.slideStats ?? []).map((stat) => String(stat.slideId)));
  return sessionSlides(session).flatMap((slide, index) => {
    if (lifecycleOf(slide.type) !== 'response') return [];
    const slideId = slideIdOf(slide);
    if (!readSlideState(session, slideId) && !withStats.has(slideId)) return [];
    return [exportSlideOf(slide, index)];
  });
};

/** `"Question — Statement"` → `"Statement"` when the column repeats the slide label. */
const shortColumn = (column: string, label: string) => {
  const prefix = `${label} — `;
  return column.startsWith(prefix) ? column.slice(prefix.length) : column;
};

/** One answer as a single text cell: the cell itself for one column, `column: value; …` for several. */
export const formatAnswer = (slide: ExportSlide, answer: ExportAnswer | null): string | null => {
  if (!answer) return null;
  const cells = slide.cells(answer);
  if (slide.columns.length === 1) {
    const cell = cells[0];
    return cell === null || cell === undefined || cell === '' ? null : String(cell);
  }
  const parts = cells.flatMap((cell, i) =>
    cell === null || cell === undefined || cell === '' ? [] : [`${shortColumn(slide.columns[i]!, slide.label)}: ${cell}`]
  );
  return parts.length ? parts.join('; ') : null;
};

// ---------------------------------------------------------------------------
// Spreadsheet safety
// ---------------------------------------------------------------------------

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Spreadsheet formula injection: a text cell starting with `=`, `+`, `-`, `@`
 * (or a tab / carriage return) is evaluated by Excel and LibreOffice when the
 * file is opened. A leading apostrophe makes it plain text.
 */
export const neutralizeFormula = (value: string) => (FORMULA_START.test(value) ? `'${value}` : value);

// ---------------------------------------------------------------------------
// Participants and answers, streamed in batches
// ---------------------------------------------------------------------------

/**
 * Every participant of the session, ranked like the leaderboard: score
 * descending; equal scores in the leaderboard's own order (`standings`), then
 * join order.
 */
export const loadRankedParticipants = async (
  sessionId: string,
  standings: readonly { participantId: string }[] = []
): Promise<RankedParticipant[]> => {
  const rows = await PresentationParticipantModel.find({ sessionId })
    .select('name score correctCount joinedAt kickedAt')
    .lean();
  const position = new Map(standings.map((entry, i) => [entry.participantId, i]));
  const at = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  rows.sort(
    (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) ||
      at(String(a._id)) - at(String(b._id)) ||
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      String(a._id).localeCompare(String(b._id))
  );
  return rows.map((p, i) => ({
    participantId: String(p._id),
    name: p.name,
    rank: i + 1,
    score: p.score ?? 0,
    correctCount: p.correctCount ?? 0,
    joinedAt: p.joinedAt,
    kicked: Boolean(p.kickedAt),
  }));
};

export const toStoredAnswer = (answer: {
  participantId: unknown;
  slideId?: unknown;
  optionIndex?: number | null;
  text?: string | null;
  payload?: unknown;
  isCorrect: boolean;
  score: number;
  timeMs: number;
  createdAt?: Date | null;
}): StoredAnswer => ({
  participantId: String(answer.participantId),
  slideId: String(answer.slideId),
  optionIndex: answer.optionIndex ?? null,
  text: answer.text ?? null,
  payload: answer.payload ?? null,
  isCorrect: Boolean(answer.isCorrect),
  score: answer.score ?? 0,
  timeMs: answer.timeMs ?? 0,
  createdAt: answer.createdAt ?? null,
});

const ANSWER_FIELDS = 'participantId slideId optionIndex text payload isCorrect score timeMs createdAt';

/** participantId → slideId → answer, for a batch of participants. */
export type AnswerIndex = Map<string, Map<string, StoredAnswer>>;

export interface ParticipantBatch {
  participants: RankedParticipant[];
  answers: AnswerIndex;
}

export const EXPORT_BATCH_SIZE = 500;

/**
 * The participants in rank order with their answers, a batch at a time, so a
 * large session streams with bounded memory.
 */
export async function* participantBatches(
  sessionId: string,
  participants: RankedParticipant[],
  batchSize = EXPORT_BATCH_SIZE
): AsyncGenerator<ParticipantBatch> {
  const sid = new mongoose.Types.ObjectId(sessionId);
  for (let start = 0; start < participants.length; start += batchSize) {
    const batch = participants.slice(start, start + batchSize);
    const rows = await PresentationAnswerModel.find({
      sessionId: sid,
      participantId: { $in: batch.map((p) => new mongoose.Types.ObjectId(p.participantId)) },
    })
      .select(ANSWER_FIELDS)
      .lean();
    const answers: AnswerIndex = new Map();
    for (const row of rows) {
      if (!row.slideId) continue;
      const answer = toStoredAnswer(row);
      let bySlide = answers.get(answer.participantId);
      if (!bySlide) answers.set(answer.participantId, (bySlide = new Map()));
      bySlide.set(answer.slideId, answer);
    }
    yield { participants: batch, answers };
  }
}

/** Every stored answer to one slide (for summaries of types without a known results shape). */
export const loadSlideAnswers = async (sessionId: string, slideId: string): Promise<StoredAnswer[]> => {
  const rows = await PresentationAnswerModel.find({ sessionId, slideId }).select(ANSWER_FIELDS).lean();
  return rows.map(toStoredAnswer);
};

// ---------------------------------------------------------------------------
// Row layouts
// ---------------------------------------------------------------------------

/** "Responses": one row per participant × response slide (CSV and the XLSX sheet). */
export const RESPONSE_HEADERS = [
  'Rank',
  'Participant',
  'Participant ID',
  'Total score',
  'Slide',
  'Slide type',
  'Question',
  'Answered',
  'Answer',
  'Correct',
  'Points',
  'Response time (s)',
  'Answered at',
] as const;

export const responseRow = (
  participant: RankedParticipant,
  slide: ExportSlide,
  answer: StoredAnswer | null
): ExportCell[] => [
  participant.rank,
  participant.name,
  participant.participantId,
  participant.score,
  slide.slideIndex + 1,
  slide.typeName,
  slide.label,
  answer ? 'yes' : 'no',
  formatAnswer(slide, answer),
  answer && slide.scored ? (answer.isCorrect ? 'yes' : 'no') : null,
  answer && slide.scored ? answer.score : null,
  answer ? Math.round(answer.timeMs / 100) / 10 : null,
  answer?.createdAt ? answer.createdAt.toISOString() : null,
];

/** "Participants": one row per participant, every response slide's export columns side by side. */
export const matrixHeaders = (slides: ExportSlide[]): string[] => [
  'Rank',
  'Participant',
  'Total score',
  'Correct answers',
  ...slides.flatMap((slide) => slide.columns.map((column) => `${slide.slideIndex + 1}. ${column}`)),
];

export const matrixRow = (participant: RankedParticipant, slides: ExportSlide[], answers: Map<string, StoredAnswer> | undefined): ExportCell[] => [
  participant.rank,
  participant.name,
  participant.score,
  participant.correctCount,
  ...slides.flatMap((slide) => slide.cells(answers?.get(slide.slideId) ?? null)),
];
