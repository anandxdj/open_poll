import mongoose from 'mongoose';
import { getEntitlements } from '../common/plans/entitlements';
import { PresentationSessionModel } from '../modules/presentations/models/session.model';
import { getSlideType, replayDistribution } from '../modules/presentations/slides';
import type { Migration } from './runner';

/**
 * Sessions (W1-A1). Before this, a deck held one run at a time: opening the
 * lobby wiped the previous participants and answers. Each deck that still has
 * a run's data gets that run as legacy session #1:
 *
 * 1. `presentationsessions` indexes (the collection is new: syncIndexes).
 * 2. Per deck with participants or answers lacking `sessionId`: upsert session
 *    `{presentationId, runNumber: 1}` (ended, `deckSnapshot` = the deck's
 *    current slides, aggregates computed from the stored data), then set
 *    `sessionId` on its participants and `sessionId`/`slideId` on its answers
 *    (`slideId = slides[slideIndex]._id`; answers whose slide was deleted since
 *    get one fresh id per index).
 * 3. Decks still in `lobby`/`active` are ended (a live run cannot survive the
 *    Redis key change; deploy with no live sessions).
 * 4. New partial unique indexes on participants and answers, then the old
 *    per-deck unique indexes are dropped; new deck indexes.
 *
 * Raw collection operations throughout (no schema dependency for the data).
 * Idempotent: only participants/answers without `sessionId` are touched, the
 * session upsert only inserts, index creation and drops tolerate re-runs.
 */

type Doc = Record<string, any>;
type Db = mongoose.mongo.Db;

const FINAL_LEADERBOARD_SIZE = 100;
const DAY_MS = 24 * 3600 * 1000;
const INDEX_NOT_FOUND = 27;
const NAMESPACE_NOT_FOUND = 26;

const dropIndexIfPresent = async (db: Db, collection: string, name: string, log: (m: string) => void) => {
  try {
    await db.collection(collection).dropIndex(name);
    log(`  ${collection}: dropped ${name}`);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== INDEX_NOT_FOUND && code !== NAMESPACE_NOT_FOUND) throw error;
  }
};

/** Plan entitlements of the deck's workspace (free plan when it has none). */
const entitlementsFor = async (db: Db, workspaceId: unknown) => {
  const workspace = workspaceId ? await db.collection('workspaces').findOne({ _id: workspaceId as any }) : null;
  const { plan, limits } = getEntitlements((workspace as Doc | null) ?? { plan: 'free' });
  const chosen: number | null = (workspace as Doc | null)?.settings?.retentionDays ?? null;
  const retentionDays =
    limits.retentionDays === null ? chosen : Math.min(chosen ?? limits.retentionDays, limits.retentionDays);
  return { plan, audienceCap: limits.audienceCap, retentionDays };
};

const minDate = (dates: (Date | null | undefined)[]) =>
  dates.filter((d): d is Date => d instanceof Date).reduce<Date | null>((a, b) => (!a || b < a ? b : a), null);
const maxDate = (dates: (Date | null | undefined)[]) =>
  dates.filter((d): d is Date => d instanceof Date).reduce<Date | null>((a, b) => (!a || b > a ? b : a), null);

/** The legacy session document for one deck, built from its stored run. */
const buildLegacySession = async (db: Db, deck: Doc) => {
  const presentationId = deck._id;
  const slides: Doc[] = deck.slides ?? [];
  const participants = await db
    .collection('presentationparticipants')
    .find({ presentationId })
    .sort({ score: -1, joinedAt: 1 })
    .toArray();
  const answers = await db
    .collection('presentationanswers')
    .find({ presentationId })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  const startedAt = minDate(participants.map((p) => p.joinedAt)) ?? deck.updatedAt ?? deck.createdAt ?? new Date();
  const endedAt = maxDate([deck.updatedAt, ...answers.map((a) => a.createdAt), startedAt]) ?? startedAt;

  const answersByIndex = new Map<number, Doc[]>();
  for (const answer of answers) {
    answersByIndex.set(answer.slideIndex, [...(answersByIndex.get(answer.slideIndex) ?? []), answer]);
  }

  // Slides up to the last one shown (a legacy run only moved forward), plus any slide with answers.
  const lastShown = Math.max(deck.currentSlideIndex ?? -1, ...answersByIndex.keys());
  const slideStates: Record<string, Doc> = {};
  const slideStats: Doc[] = [];
  for (let index = 0; index <= lastShown && index < slides.length; index++) {
    const slide = slides[index]!;
    const response = getSlideType(slide.type)?.lifecycle === 'response';
    const slideAnswers = answersByIndex.get(index) ?? [];
    slideStates[String(slide._id)] = {
      openedAt: minDate(slideAnswers.map((a) => a.createdAt)) ?? startedAt,
      endsAt: null,
      pausedRemainingMs: null,
      closedAt: response ? endedAt : null,
      revealedAt: response ? endedAt : null,
    };
    if (response) {
      slideStats.push({
        slideId: slide._id,
        slideIndex: index,
        type: slide.type,
        answeredCount: slideAnswers.length,
        distribution: replayDistribution(slide, slideAnswers),
      });
    }
  }

  const entitlementsSnapshot = await entitlementsFor(db, deck.workspaceId);
  const currentSlide = slides[deck.currentSlideIndex ?? -1];
  return {
    presentationId,
    workspaceId: deck.workspaceId ?? null,
    hostUserId: deck.creatorId ?? null,
    runNumber: 1,
    pace: 'presenter',
    status: 'ended',
    isLive: false,
    joinCode: deck.joinCode,
    startedAt,
    endedAt,
    currentSlideId: currentSlide?._id ?? null,
    currentSlideIndex: currentSlide ? deck.currentSlideIndex : -1,
    slideStates,
    deckSnapshot: slides,
    themeSnapshot: null,
    settingsSnapshot: null,
    entitlementsSnapshot,
    participantCount: participants.length,
    answerCount: answers.length,
    finalLeaderboard: participants.slice(0, FINAL_LEADERBOARD_SIZE).map((p, i) => ({
      participantId: String(p._id),
      name: p.name,
      score: p.score ?? 0,
      correctCount: p.correctCount ?? 0,
      rank: i + 1,
    })),
    slideStats,
    retainUntil:
      entitlementsSnapshot.retentionDays == null
        ? null
        : new Date(endedAt.getTime() + entitlementsSnapshot.retentionDays * DAY_MS),
    createdAt: startedAt,
    updatedAt: new Date(),
    __v: 0,
  };
};

/** Moves one deck's stored run into legacy session #1. */
const migrateDeck = async (db: Db, presentationId: mongoose.Types.ObjectId, log: (m: string) => void) => {
  const deck = await db.collection('presentations').findOne({ _id: presentationId });
  if (!deck) {
    log(`  deck ${presentationId}: missing, participants/answers left without a session`);
    return;
  }
  const sessions = db.collection('presentationsessions');
  const existing = await sessions.findOne({ presentationId, runNumber: 1 }, { projection: { _id: 1, startedAt: 1 } });
  let session = existing;
  if (!session) {
    const doc = await buildLegacySession(db, deck);
    session = await sessions.findOneAndUpdate(
      { presentationId, runNumber: 1 },
      { $setOnInsert: doc },
      { upsert: true, returnDocument: 'after', projection: { _id: 1, startedAt: 1 } }
    );
  }
  const sessionId = session!._id;

  const participants = await db
    .collection('presentationparticipants')
    .updateMany(
      { presentationId, sessionId: { $exists: false } },
      { $set: { sessionId, kickedAt: null, locale: null } }
    );

  const slides: Doc[] = deck.slides ?? [];
  const indexes: number[] = await db
    .collection('presentationanswers')
    .distinct('slideIndex', { presentationId, sessionId: { $exists: false } });
  let answers = 0;
  for (const slideIndex of indexes) {
    // A slide deleted after the run: one fresh id keeps its answers apart.
    const slideId = slides[slideIndex]?._id ?? new mongoose.Types.ObjectId();
    const result = await db
      .collection('presentationanswers')
      .updateMany(
        { presentationId, slideIndex, sessionId: { $exists: false } },
        { $set: { sessionId, slideId, clientAnswerId: null, via: 'rest' } }
      );
    answers += result.modifiedCount;
  }

  await db.collection('presentations').updateOne(
    { _id: presentationId },
    { $set: { activeSessionId: null, lastSessionAt: session!.startedAt ?? null }, $max: { sessionCount: 1 } }
  );
  log(`  deck ${presentationId}: session ${sessionId}, ${participants.modifiedCount} participants, ${answers} answers`);
};

const migration: Migration = {
  id: 30,
  name: 'presentation-sessions',
  async up({ db, log }) {
    const dropped = await PresentationSessionModel.syncIndexes();
    log(`  presentationsessions: indexes in sync${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);

    const unassigned = { sessionId: { $exists: false } };
    const deckIds = new Map<string, mongoose.Types.ObjectId>();
    for (const collection of ['presentationparticipants', 'presentationanswers']) {
      const ids: mongoose.Types.ObjectId[] = await db.collection(collection).distinct('presentationId', unassigned);
      for (const id of ids) deckIds.set(String(id), id);
    }
    log(`  ${deckIds.size} deck(s) with a run to move into a session`);
    for (const presentationId of deckIds.values()) await migrateDeck(db, presentationId, log);

    const ended = await db
      .collection('presentations')
      .updateMany({ status: { $in: ['lobby', 'active'] } }, { $set: { status: 'ended', activeSessionId: null } });
    log(`  presentations: ended ${ended.modifiedCount} deck(s) left in lobby/active`);

    const sessionScoped = { partialFilterExpression: { sessionId: { $exists: true } } };
    await db
      .collection('presentationparticipants')
      .createIndex({ sessionId: 1, deviceId: 1 }, { unique: true, ...sessionScoped });
    await db
      .collection('presentationanswers')
      .createIndex({ sessionId: 1, slideId: 1, participantId: 1 }, { unique: true, ...sessionScoped });
    await db.collection('presentationanswers').createIndex({ sessionId: 1, slideId: 1 });
    await dropIndexIfPresent(db, 'presentationparticipants', 'presentationId_1_deviceId_1', log);
    await dropIndexIfPresent(db, 'presentationanswers', 'presentationId_1_slideIndex_1_participantId_1', log);
    log('  participants/answers: session-scoped unique indexes present');

    const presentations = db.collection('presentations');
    await presentations.createIndex({ workspaceId: 1, updatedAt: -1 });
    await presentations.createIndex({ workspaceId: 1, folderId: 1, updatedAt: -1 });
    await presentations.createIndex({ 'legacy.source': 1, 'legacy.sourceId': 1 }, { sparse: true });
    log('  presentations: workspace, folder and legacy indexes present');
  },
};

export default migration;
