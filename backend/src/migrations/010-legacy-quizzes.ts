import { randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import type { Migration } from './runner';

type Db = mongoose.mongo.Db;
type ObjectId = mongoose.Types.ObjectId;
type Doc = Record<string, unknown> & { _id: ObjectId };

/**
 * Copies the decks of the removed quizzes module into the presentation
 * collections. The quiz models matched the presentation ones apart from names
 * (`quizId` → `presentationId`; status `question`/`reveal`/`leaderboard` from
 * before the `active` collapse), so documents are copied as they are:
 *
 * - quizzes → presentations, keeping `_id` (old /quiz/host/:id links keep
 *   working) unless a deck already uses it, and the join code unless a deck or
 *   another quiz already uses it. Copies are marked `legacy: {source: 'quiz',
 *   sourceId}`; a quiz that already has a copy is not copied again.
 * - Live statuses become `ended`: no Redis state survives the move, so the
 *   host starts a new session from the copy.
 * - quizparticipants / quizanswers → presentationparticipants /
 *   presentationanswers with `presentationId` = the copy's id, keeping `_id`s
 *   (answers point at participants). Re-runs skip what is already there.
 *
 * The legacy collections are left in place; drop them by hand once checked.
 * Raw collection operations only, so later schema changes cannot break it.
 */

export const LEGACY_COLLECTIONS = { decks: 'quizzes', participants: 'quizparticipants', answers: 'quizanswers' } as const;
export const TARGET_COLLECTIONS = {
  decks: 'presentations',
  participants: 'presentationparticipants',
  answers: 'presentationanswers',
} as const;

const BATCH = 500;
const LIVE_STATUSES = new Set(['lobby', 'active', 'question', 'reveal', 'leaderboard']);
const JOIN_CODE = /^\d{6}$/;

const isDuplicateKey = (error: unknown) => (error as { code?: number } | null)?.code === 11000;

async function collectionExists(db: Db, name: string) {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

/** A 6-digit code no deck and no other quiz holds. */
async function freeJoinCode(db: Db, reserved: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomInt(100000, 1000000).toString();
    if (reserved.has(code)) continue;
    const [deck, quiz] = await Promise.all([
      db.collection(TARGET_COLLECTIONS.decks).findOne({ joinCode: code }, { projection: { _id: 1 } }),
      db.collection(LEGACY_COLLECTIONS.decks).findOne({ joinCode: code }, { projection: { _id: 1 } }),
    ]);
    if (!deck && !quiz) return code;
  }
  throw new Error('Could not allocate a free join code');
}

/** Copies one quiz; returns the id of its presentation copy. */
async function copyQuiz(db: Db, quiz: Doc, reserved: Set<string>): Promise<ObjectId> {
  const decks = db.collection<Doc>(TARGET_COLLECTIONS.decks);
  const idTaken = await decks.findOne({ _id: quiz._id }, { projection: { _id: 1 } });
  const _id = idTaken ? new mongoose.Types.ObjectId() : quiz._id;

  let joinCode = typeof quiz.joinCode === 'string' ? quiz.joinCode : '';
  if (!JOIN_CODE.test(joinCode) || (await decks.findOne({ joinCode }, { projection: { _id: 1 } }))) {
    joinCode = await freeJoinCode(db, reserved);
  }

  const status = typeof quiz.status === 'string' && LIVE_STATUSES.has(quiz.status) ? 'ended' : (quiz.status ?? 'draft');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await decks.insertOne({ ...quiz, _id, joinCode, status, legacy: { source: 'quiz', sourceId: quiz._id } });
      reserved.add(joinCode);
      return _id;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Another writer took the code between the check and the insert.
      joinCode = await freeJoinCode(db, reserved);
    }
  }
  throw new Error(`Could not copy quiz ${String(quiz._id)}`);
}

/** Inserts the documents, skipping ones a previous run already copied. */
async function insertMissing(db: Db, collection: string, docs: Doc[]) {
  if (docs.length === 0) return 0;
  try {
    return (await db.collection<Doc>(collection).insertMany(docs, { ordered: false })).insertedCount;
  } catch (error) {
    const bulk = error as { writeErrors?: Array<{ code?: number }> | { code?: number }; insertedCount?: number; result?: { insertedCount?: number } };
    const writeErrors = Array.isArray(bulk.writeErrors) ? bulk.writeErrors : bulk.writeErrors ? [bulk.writeErrors] : [];
    if (writeErrors.length === 0 || writeErrors.some((writeError) => writeError.code !== 11000)) throw error;
    return bulk.insertedCount ?? bulk.result?.insertedCount ?? 0;
  }
}

/** Copies the children of the copied quizzes, re-pointing `quizId` at the copy. */
async function copyChildren(db: Db, from: string, to: string, copies: Map<string, ObjectId>) {
  const quizIds = [...copies.keys()].map((id) => new mongoose.Types.ObjectId(id));
  let copied = 0;
  let batch: Doc[] = [];
  const cursor = db.collection<Doc>(from).find({ quizId: { $in: quizIds } });
  for await (const doc of cursor) {
    const { quizId, ...rest } = doc;
    batch.push({ ...rest, presentationId: copies.get(String(quizId))! } as Doc);
    if (batch.length >= BATCH) {
      copied += await insertMissing(db, to, batch);
      batch = [];
    }
  }
  copied += await insertMissing(db, to, batch);
  return copied;
}

export async function copyLegacyQuizzes(db: Db, log: (message: string) => void = () => {}) {
  if (!(await collectionExists(db, LEGACY_COLLECTIONS.decks))) {
    log('  no legacy quizzes collection, nothing to copy');
    return { decks: 0, participants: 0, answers: 0 };
  }
  const quizzes = db.collection<Doc>(LEGACY_COLLECTIONS.decks);
  if ((await quizzes.estimatedDocumentCount()) === 0) {
    log('  legacy quizzes collection is empty, nothing to copy');
    return { decks: 0, participants: 0, answers: 0 };
  }

  // quiz id → copy id, for quizzes copied by an earlier (possibly interrupted) run too.
  const copies = new Map<string, ObjectId>();
  const earlier = db
    .collection<Doc>(TARGET_COLLECTIONS.decks)
    .find({ 'legacy.source': 'quiz' }, { projection: { _id: 1, 'legacy.sourceId': 1 } });
  for await (const deck of earlier) {
    const sourceId = (deck.legacy as { sourceId?: unknown } | undefined)?.sourceId;
    if (sourceId != null) copies.set(String(sourceId), deck._id);
  }

  let decks = 0;
  const reserved = new Set<string>();
  for await (const quiz of quizzes.find({})) {
    if (copies.has(String(quiz._id))) continue;
    copies.set(String(quiz._id), await copyQuiz(db, quiz, reserved));
    decks += 1;
  }

  const participants = await copyChildren(db, LEGACY_COLLECTIONS.participants, TARGET_COLLECTIONS.participants, copies);
  const answers = await copyChildren(db, LEGACY_COLLECTIONS.answers, TARGET_COLLECTIONS.answers, copies);
  log(`  copied ${decks} quizzes, ${participants} participants, ${answers} answers`);
  return { decks, participants, answers };
}

const migration: Migration = {
  id: 10,
  name: 'legacy-quizzes',
  async up({ db, log }) {
    await copyLegacyQuizzes(db, log);
  },
};

export default migration;
