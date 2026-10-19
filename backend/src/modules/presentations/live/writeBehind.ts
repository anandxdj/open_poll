import { PresentationAnswerModel, type AnswerChannel } from '../models/answer.model';
import { PresentationParticipantModel } from '../models/participant.model';

/**
 * Durable copy of accepted answers. Redis is the source of truth while a
 * session runs (the answer script already wrote the result), so Mongo is
 * filled in batches off the request path: every 50 ms, or at once when 200
 * answers are waiting. Whatever a crash or a Mongo outage loses is rebuilt from
 * `psess:{sid}:results:{slide}` when the session ends (`snapshot.ts`).
 *
 * Each batch inserts the answers (a duplicate key means reconciliation or a
 * replay got there first), then adds the points of the answers it actually
 * inserted to the participants — unless the session was already finalized
 * (`scoreFinalAt`): once the end-of-session reconciliation has recomputed
 * totals from the stored answers, a late increment would count twice.
 */

export interface PendingAnswer {
  presentationId: string;
  sessionId: string;
  participantId: string;
  slideId: string;
  slideIndex: number;
  optionIndex: number | null;
  text: string | null;
  payload: unknown;
  isCorrect: boolean;
  score: number;
  timeMs: number;
  clientAnswerId: string | null;
  via: AnswerChannel;
}

const BATCH_INTERVAL_MS = 50;
const MAX_BATCH = 200;

const queue: PendingAnswer[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> = Promise.resolve();

interface BulkWriteIssue {
  index?: number;
  code?: number;
  err?: { code?: number };
}

/** The per-document failures of a bulk insert (the driver reports one error as a bare object). */
const writeErrorsOf = (error: unknown): BulkWriteIssue[] => {
  const raw = (error as { writeErrors?: unknown } | null)?.writeErrors;
  if (Array.isArray(raw)) return raw;
  return raw ? [raw as BulkWriteIssue] : [];
};

const DUPLICATE_KEY = 11000;

/** Adds the points of freshly stored answers to their participants (skipped once scores are final). */
export const applyParticipantIncrements = async (inserted: PendingAnswer[]) => {
  if (inserted.length === 0) return;
  const totals = new Map<string, { sessionId: string; score: number; correct: number }>();
  for (const answer of inserted) {
    const total = totals.get(answer.participantId) ?? { sessionId: answer.sessionId, score: 0, correct: 0 };
    total.score += answer.score;
    total.correct += answer.isCorrect ? 1 : 0;
    totals.set(answer.participantId, total);
  }
  await PresentationParticipantModel.bulkWrite(
    [...totals].map(([participantId, total]) => ({
      updateOne: {
        filter: { _id: participantId, sessionId: total.sessionId, scoreFinalAt: null },
        update: { $inc: { score: total.score, correctCount: total.correct } },
      },
    })),
    { ordered: false }
  );
};

/**
 * Inserts a batch and returns the answers that are new in Mongo. A duplicate
 * (`{sessionId, slideId, participantId}` unique) is an answer that is already
 * stored, so it is not new and must not add points again.
 */
export const insertAnswerBatch = async (batch: PendingAnswer[]): Promise<PendingAnswer[]> => {
  if (batch.length === 0) return [];
  try {
    await PresentationAnswerModel.insertMany(batch, { ordered: false });
    return batch;
  } catch (error) {
    const errors = writeErrorsOf(error);
    const failed = new Set(errors.map((e) => e.index));
    if (errors.length === 0 || errors.some((e) => e.index === undefined)) {
      // Nothing is known about which documents landed: leave it to reconciliation.
      console.error('[Presentation] Answer write-behind failed:', error);
      return [];
    }
    for (const e of errors) {
      if ((e.code ?? e.err?.code) !== DUPLICATE_KEY) console.error('[Presentation] Answer write-behind rejected a document:', e);
    }
    return batch.filter((_, index) => !failed.has(index));
  }
};

const persistBatch = async (batch: PendingAnswer[]) => {
  try {
    await applyParticipantIncrements(await insertAnswerBatch(batch));
  } catch (error) {
    console.error('[Presentation] Answer write-behind failed:', error);
  }
};

const drainQueue = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = queue.splice(0, MAX_BATCH);
  if (batch.length > 0) running = running.then(() => persistBatch(batch));
  return running;
};

/** Queues one accepted answer for the next batch. Never throws. */
export const enqueueAnswerWrite = (answer: PendingAnswer) => {
  queue.push(answer);
  if (queue.length >= MAX_BATCH) {
    void drainQueue();
  } else if (!timer) {
    timer = setTimeout(() => void drainQueue(), BATCH_INTERVAL_MS);
    timer.unref?.();
  }
};

/** Writes everything queued and waits for it (graceful shutdown, tests). */
export const flushWriteBehind = async () => {
  while (queue.length > 0) await drainQueue();
  await running;
};

export const pendingWriteBehind = () => queue.length;
