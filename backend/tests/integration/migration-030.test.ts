import { afterAll, beforeAll, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import migration from '../../src/migrations/030-presentation-sessions';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Migration 030 on fixture data shaped like the single-run engine stored it:
 * decks with a run (ended, still active, lobby without participants, a deck
 * edited after its run), a draft, the old per-deck unique indexes. Run twice.
 */
describeIntegration('migration 030 — presentation sessions', () => {
  let server: TestServer;
  let host: TestUser;
  let db: mongoose.mongo.Db;
  const id = () => new mongoose.Types.ObjectId();
  const logs: string[] = [];
  const run = () => migration.up({ db, connection: mongoose.connection, log: (m) => logs.push(m) });

  const T = (minutes: number) => new Date(Date.UTC(2026, 5, 1, 9, minutes));
  const slideIds = { select: id(), cloud: id(), board: id(), extra: id() };
  const decks = { ended: id(), active: id(), lobby: id(), draft: id(), pro: id() };
  const workspaceId = id();
  const people = { ada: id(), linus: id(), grace: id(), alan: id() };

  const slide = (_id: mongoose.Types.ObjectId, type: string, extra: Record<string, unknown> = {}) => ({
    _id,
    type,
    question: `${type}?`,
    options: [],
    acceptedAnswers: [],
    statements: [],
    minLabel: '',
    maxLabel: '',
    scaleMax: 5,
    items: [],
    maxEntries: 3,
    timeLimit: 30,
    points: 1000,
    scoreDependsOnTime: true,
    ...extra,
  });

  const deck = (_id: mongoose.Types.ObjectId, status: string, currentSlideIndex: number, extra: Record<string, unknown> = {}) => ({
    _id,
    creatorId: host.id,
    title: `Deck ${status}`,
    joinCode: String(100000 + Math.floor(Math.random() * 899999)),
    status,
    currentSlideIndex,
    questionStartedAt: null,
    questionEndsAt: null,
    slides: [
      slide(slideIds.select, 'select_answer', {
        options: [
          { text: 'Yes', isCorrect: true },
          { text: 'No', isCorrect: false },
        ],
      }),
      slide(slideIds.cloud, 'wordcloud'),
      slide(slideIds.board, 'leaderboard'),
    ],
    createdAt: T(0),
    updatedAt: T(30),
    __v: 0,
    ...extra,
  });

  const participant = (_id: mongoose.Types.ObjectId, presentationId: mongoose.Types.ObjectId, name: string, score: number, joinedMinute: number) => ({
    _id,
    presentationId,
    name,
    deviceId: `device-${name}`,
    token: `token-${name}`.padEnd(48, '0'),
    score,
    correctCount: score > 0 ? 1 : 0,
    joinedAt: T(joinedMinute),
  });

  const answer = (presentationId: mongoose.Types.ObjectId, participantId: mongoose.Types.ObjectId, slideIndex: number, extra: Record<string, unknown>, minute: number) => ({
    _id: id(),
    presentationId,
    participantId,
    slideIndex,
    optionIndex: null,
    text: null,
    payload: null,
    isCorrect: false,
    score: 0,
    timeMs: 1000,
    createdAt: T(minute),
    updatedAt: T(minute),
    ...extra,
  });

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
    db = mongoose.connection.db!;
    host = await createVerifiedUser();

    // The collections as the single-run engine left them: its unique indexes only.
    for (const name of ['presentationparticipants', 'presentationanswers']) {
      await db.collection(name).drop().catch(() => {});
    }
    await db.collection('presentationparticipants').createIndex({ presentationId: 1, deviceId: 1 }, { unique: true });
    await db
      .collection('presentationanswers')
      .createIndex({ presentationId: 1, slideIndex: 1, participantId: 1 }, { unique: true });

    await db.collection('workspaces').insertOne({
      _id: workspaceId,
      name: 'Pro team',
      slug: `pro-${workspaceId}`,
      type: 'team',
      ownerId: new mongoose.Types.ObjectId(host.id),
      plan: 'pro',
      settings: { retentionDays: 30 },
    });
    await db.collection('presentations').insertMany([
      deck(decks.ended, 'ended', 2),
      deck(decks.active, 'active', 0),
      deck(decks.lobby, 'lobby', -1),
      deck(decks.draft, 'draft', -1),
      deck(decks.pro, 'ended', 0, { workspaceId }),
    ]);
    await db.collection('presentationparticipants').insertMany([
      participant(people.ada, decks.ended, 'Ada', 900, 1),
      participant(people.linus, decks.ended, 'Linus', 0, 2),
      participant(people.grace, decks.active, 'Grace', 0, 3),
      participant(people.alan, decks.pro, 'Alan', 0, 4),
    ]);
    await db.collection('presentationanswers').insertMany([
      answer(decks.ended, people.ada, 0, { optionIndex: 0, isCorrect: true, score: 900 }, 5),
      answer(decks.ended, people.linus, 0, { optionIndex: 1 }, 6),
      answer(decks.ended, people.ada, 1, { payload: { entries: ['Coffee'] } }, 7),
      answer(decks.ended, people.linus, 1, { payload: { entries: ['coffee', 'Tea'] } }, 8),
      // Answered on a slide that was deleted from the deck after the run.
      answer(decks.ended, people.ada, 5, { text: 'gone' }, 9),
      answer(decks.ended, people.linus, 5, { text: 'gone too' }, 9),
    ]);
  }, 20_000);

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('moves each stored run into legacy session #1 with its snapshot', async () => {
    await run();

    const sessions = await db.collection('presentationsessions').find().toArray();
    expect(sessions.map((s) => String(s.presentationId)).sort()).toEqual(
      [decks.ended, decks.active, decks.pro].map(String).sort(),
    );

    const ended = sessions.find((s) => String(s.presentationId) === String(decks.ended))!;
    expect(ended).toMatchObject({
      runNumber: 1,
      status: 'ended',
      isLive: false,
      hostUserId: host.id,
      startedAt: T(1),
      endedAt: T(30),
      currentSlideIndex: 2,
      participantCount: 2,
      answerCount: 6,
      themeSnapshot: null,
      entitlementsSnapshot: { plan: 'free', audienceCap: 100, retentionDays: 365 },
    });
    expect(String(ended.currentSlideId)).toBe(String(slideIds.board));
    expect(ended.deckSnapshot.map((s: any) => String(s._id))).toEqual(
      [slideIds.select, slideIds.cloud, slideIds.board].map(String),
    );
    expect(ended.retainUntil).toEqual(new Date(T(30).getTime() + 365 * 24 * 3600 * 1000));
    expect(ended.finalLeaderboard).toEqual([
      { participantId: String(people.ada), name: 'Ada', score: 900, correctCount: 1, rank: 1 },
      { participantId: String(people.linus), name: 'Linus', score: 0, correctCount: 0, rank: 2 },
    ]);
    expect(Object.keys(ended.slideStates).sort()).toEqual([slideIds.select, slideIds.cloud, slideIds.board].map(String).sort());
    expect(ended.slideStates[String(slideIds.select)]).toMatchObject({ openedAt: T(5), closedAt: T(30), revealedAt: T(30) });
    expect(ended.slideStates[String(slideIds.board)]).toMatchObject({ closedAt: null, revealedAt: null });
    expect(ended.slideStats).toEqual([
      {
        slideId: slideIds.select,
        slideIndex: 0,
        type: 'select_answer',
        answeredCount: 2,
        distribution: {
          kind: 'options',
          counts: [1, 1],
          options: [
            { text: 'Yes', isCorrect: true },
            { text: 'No', isCorrect: false },
          ],
        },
      },
      {
        slideId: slideIds.cloud,
        slideIndex: 1,
        type: 'wordcloud',
        answeredCount: 2,
        distribution: {
          kind: 'words',
          words: [
            { text: 'Coffee', count: 2 },
            { text: 'Tea', count: 1 },
          ],
        },
      },
    ]);

    const pro = sessions.find((s) => String(s.presentationId) === String(decks.pro))!;
    expect(pro.entitlementsSnapshot).toEqual({ plan: 'pro', audienceCap: 1000, retentionDays: 30 });
    expect(String(pro.workspaceId)).toBe(String(workspaceId));
    expect(pro.retainUntil).toEqual(new Date(pro.endedAt.getTime() + 30 * 24 * 3600 * 1000));
  });

  it('assigns sessionId to participants and sessionId/slideId to answers', async () => {
    const sessionOf = async (presentationId: mongoose.Types.ObjectId) =>
      (await db.collection('presentationsessions').findOne({ presentationId }))!._id;

    const participants = await db.collection('presentationparticipants').find().toArray();
    for (const p of participants) {
      expect(String(p.sessionId)).toBe(String(await sessionOf(p.presentationId)));
      expect(p).toMatchObject({ kickedAt: null, locale: null });
    }

    const answers = await db.collection('presentationanswers').find({ presentationId: decks.ended }).toArray();
    const endedSession = String(await sessionOf(decks.ended));
    expect(answers.every((a) => String(a.sessionId) === endedSession && a.via === 'rest')).toBe(true);
    const bySlide = (index: number) => [...new Set(answers.filter((a) => a.slideIndex === index).map((a) => String(a.slideId)))];
    expect(bySlide(0)).toEqual([String(slideIds.select)]);
    expect(bySlide(1)).toEqual([String(slideIds.cloud)]);
    // Orphaned answers share one fresh slide id, distinct from every deck slide.
    expect(bySlide(5)).toHaveLength(1);
    expect(Object.values(slideIds).map(String)).not.toContain(bySlide(5)[0]);
  });

  it('ends decks left live, mirrors the sessions on the decks, leaves drafts alone', async () => {
    const byId = async (presentationId: mongoose.Types.ObjectId) =>
      (await db.collection('presentations').findOne({ _id: presentationId }))!;
    expect(await byId(decks.ended)).toMatchObject({ status: 'ended', sessionCount: 1, activeSessionId: null, lastSessionAt: T(1) });
    expect(await byId(decks.active)).toMatchObject({ status: 'ended', sessionCount: 1, activeSessionId: null });
    expect(await byId(decks.lobby)).toMatchObject({ status: 'ended' });
    expect((await byId(decks.lobby)).sessionCount).toBeUndefined();
    const draft = await byId(decks.draft);
    expect(draft.status).toBe('draft');
    expect(draft.sessionCount).toBeUndefined();
  });

  it('replaces the per-deck unique indexes with session-scoped ones', async () => {
    const indexes = async (collection: string) =>
      Object.fromEntries((await db.collection(collection).indexes()).map((i) => [i.name, i]));
    const participants = await indexes('presentationparticipants');
    expect(participants['presentationId_1_deviceId_1']).toBeUndefined();
    expect(participants['sessionId_1_deviceId_1']).toMatchObject({
      unique: true,
      partialFilterExpression: { sessionId: { $exists: true } },
    });
    const answers = await indexes('presentationanswers');
    expect(answers['presentationId_1_slideIndex_1_participantId_1']).toBeUndefined();
    expect(answers['sessionId_1_slideId_1_participantId_1']).toMatchObject({ unique: true });
    expect(answers['sessionId_1_slideId_1']).toBeDefined();
    const sessions = await indexes('presentationsessions');
    expect(sessions['one_live_session_per_presentation']).toMatchObject({
      unique: true,
      partialFilterExpression: { isLive: true },
    });
    expect(sessions['share.token_1']).toMatchObject({ unique: true, sparse: true });
    const presentations = await indexes('presentations');
    expect(presentations['workspaceId_1_updatedAt_-1']).toBeDefined();
    expect(presentations['legacy.source_1_legacy.sourceId_1']).toMatchObject({ sparse: true });
  });

  it('is idempotent', async () => {
    const snapshot = async () => ({
      sessions: await db.collection('presentationsessions').find().sort({ _id: 1 }).toArray(),
      participants: await db.collection('presentationparticipants').find().sort({ _id: 1 }).toArray(),
      answers: await db.collection('presentationanswers').find().sort({ _id: 1 }).toArray(),
      presentations: await db.collection('presentations').find().sort({ _id: 1 }).toArray(),
    });
    const before = await snapshot();
    await run();
    expect(await snapshot()).toEqual(before);
    expect(logs.filter((line) => line.includes('deck(s) with a run'))).toEqual([
      '  3 deck(s) with a run to move into a session',
      '  0 deck(s) with a run to move into a session',
    ]);
  });

  it('lets a migrated deck run again as session #2 without touching session #1', async () => {
    const lobby = await server.request(`/api/presentations/${decks.ended}/host/open-lobby`, {
      method: 'POST',
      headers: host.headers,
    });
    expect(lobby.status).toBe(200);
    const { data } = (await lobby.json()) as { data: { session: { runNumber: number; sessionId: string } } };
    expect(data.session.runNumber).toBe(2);

    // The same device joins the new run as a new participant.
    const join = await server.request(`/api/presentations/${decks.ended}/join`, { method: 'POST', body: { name: 'Ada again' } });
    expect(join.status).toBe(200);
    expect(await db.collection('presentationparticipants').countDocuments({ presentationId: decks.ended })).toBe(3);
    const legacy = await db.collection('presentationsessions').findOne({ presentationId: decks.ended, runNumber: 1 });
    expect(legacy).toMatchObject({ status: 'ended', participantCount: 2, answerCount: 6 });
  });
});
