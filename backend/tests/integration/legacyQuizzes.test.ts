import { afterAll, beforeAll, expect, it } from 'bun:test';
import mongoose from 'mongoose';
import migration010, { copyLegacyQuizzes } from '../../src/migrations/010-legacy-quizzes';
import migration011, { LIBRARY_INDEX } from '../../src/migrations/011-library-indexes';
import { runMigrations } from '../../src/migrations/runner';
import { createPresentation, createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * Migration 010 on fixture data shaped like the removed quizzes module's
 * documents (`git show 5e63f87^:backend/src/modules/quizzes/quizzes.model.ts`,
 * statuses before and after the `active` collapse in 5897da7).
 */

const { ObjectId } = mongoose.Types;
type ObjectIdT = mongoose.Types.ObjectId;

describeIntegration('migration 010: legacy quizzes', () => {
  let server: TestServer;
  let owner: TestUser;
  let db: mongoose.mongo.Db;
  let existing: { _id: string; joinCode: string; title: string };

  const quizA = new ObjectId();
  const quizB = new ObjectId();
  let quizC: ObjectIdT;
  const ada = new ObjectId();
  const linus = new ObjectId();
  const grace = new ObjectId();
  const T = new Date('2026-07-20T10:00:00.000Z');

  const quiz = (overrides: Record<string, unknown>) => ({
    creatorId: owner.id,
    title: 'Old quiz',
    status: 'draft',
    currentSlideIndex: -1,
    questionStartedAt: null,
    questionEndsAt: null,
    slides: [
      {
        _id: new ObjectId(),
        type: 'select_answer',
        question: 'Capital of France?',
        options: [
          { _id: new ObjectId(), text: 'Paris', isCorrect: true },
          { _id: new ObjectId(), text: 'Lyon', isCorrect: false },
        ],
        acceptedAnswers: [],
        statements: [],
        minLabel: '',
        maxLabel: '',
        scaleMax: 5,
        items: [],
        maxEntries: 3,
        timeLimit: 20,
        points: 1000,
        scoreDependsOnTime: true,
      },
    ],
    createdAt: T,
    updatedAt: T,
    __v: 0,
    ...overrides,
  });

  const participant = (_id: ObjectIdT, quizId: ObjectIdT, name: string) => ({
    _id,
    quizId,
    name,
    deviceId: `device-${name}`,
    token: 'f'.repeat(48),
    score: name === 'Ada' ? 875 : 0,
    correctCount: name === 'Ada' ? 1 : 0,
    joinedAt: T,
    __v: 0,
  });

  const answer = (participantId: ObjectIdT, optionIndex: number) => ({
    _id: new ObjectId(),
    quizId: quizA,
    participantId,
    slideIndex: 0,
    optionIndex,
    text: null,
    payload: null,
    isCorrect: optionIndex === 0,
    score: optionIndex === 0 ? 875 : 0,
    timeMs: 5000,
    createdAt: T,
    updatedAt: T,
    __v: 0,
  });

  const decks = () => db.collection('presentations');
  const counts = async () => ({
    decks: await decks().countDocuments({ 'legacy.source': 'quiz' }),
    participants: await db.collection('presentationparticipants').countDocuments({}),
    answers: await db.collection('presentationanswers').countDocuments({}),
  });

  beforeAll(async () => {
    server = await startTestServer();
    await resetTestData();
    db = mongoose.connection.db!;
    owner = await createVerifiedUser();
    existing = await createPresentation(server, owner, { title: 'Current deck' });
    quizC = new ObjectId(existing._id);
  }, 20_000);

  afterAll(async () => {
    for (const name of ['quizzes', 'quizparticipants', 'quizanswers']) {
      await db?.collection(name).drop().catch(() => {});
    }
    await server?.close();
  });

  it('is a no-op without legacy collections, or with empty ones', async () => {
    expect(await copyLegacyQuizzes(db)).toEqual({ decks: 0, participants: 0, answers: 0 });
    await db.createCollection('quizzes');
    expect(await copyLegacyQuizzes(db)).toEqual({ decks: 0, participants: 0, answers: 0 });
    expect(await counts()).toEqual({ decks: 0, participants: 0, answers: 0 });
  });

  it('copies quizzes, participants and answers into the presentation collections', async () => {
    const freeCode = existing.joinCode === '111111' ? '222222' : '111111';
    await db.collection('quizzes').insertMany([
      // Mid-reveal when the module was removed (pre-collapse status).
      quiz({ _id: quizA, joinCode: freeCode, status: 'reveal', currentSlideIndex: 0, questionStartedAt: T, questionEndsAt: T }),
      // Its join code is taken by a current deck.
      quiz({ _id: quizB, title: 'Code clash', joinCode: existing.joinCode }),
      // Its _id is taken by a current deck.
      quiz({ _id: quizC, title: 'Id clash', joinCode: '999999', status: 'ended' }),
    ]);
    await db.collection('quizparticipants').insertMany([
      participant(ada, quizA, 'Ada'),
      participant(linus, quizA, 'Linus'),
      participant(grace, quizC, 'Grace'),
    ]);
    await db.collection('quizanswers').insertMany([answer(ada, 0), answer(linus, 1)]);

    expect(await copyLegacyQuizzes(db)).toEqual({ decks: 3, participants: 3, answers: 2 });

    const a = await decks().findOne({ _id: quizA });
    expect(a).toMatchObject({
      title: 'Old quiz',
      creatorId: owner.id,
      joinCode: freeCode,
      status: 'ended',
      legacy: { source: 'quiz', sourceId: quizA },
      createdAt: T,
    });

    const b = await decks().findOne({ _id: quizB });
    expect(b!.joinCode).toMatch(/^\d{6}$/);
    expect(b!.joinCode).not.toBe(existing.joinCode);
    expect(b!.status).toBe('draft');

    const c = await decks().findOne({ 'legacy.sourceId': quizC });
    expect(String(c!._id)).not.toBe(existing._id);
    expect(c!.title).toBe('Id clash');
    expect((await decks().findOne({ _id: quizC }))!.title).toBe('Current deck');

    const participants = await db.collection('presentationparticipants').find({}).sort({ name: 1 }).toArray();
    expect(participants.map((p) => [p.name, String(p._id), String(p.presentationId), 'quizId' in p])).toEqual([
      ['Ada', String(ada), String(quizA), false],
      ['Grace', String(grace), String(c!._id), false],
      ['Linus', String(linus), String(quizA), false],
    ]);
    const answers = await db.collection('presentationanswers').find({}).toArray();
    expect(answers.every((row) => String(row.presentationId) === String(quizA) && !('quizId' in row))).toBe(true);
    expect(answers.map((row) => String(row.participantId)).sort()).toEqual([String(ada), String(linus)].sort());
  });

  it('is idempotent, and completes a run that stopped half way', async () => {
    const before = await counts();
    expect(await copyLegacyQuizzes(db)).toEqual({ decks: 0, participants: 0, answers: 0 });
    expect(await counts()).toEqual(before);

    await db.collection('presentationparticipants').deleteOne({ _id: linus });
    await db.collection('presentationanswers').deleteMany({ participantId: linus });
    expect(await copyLegacyQuizzes(db)).toEqual({ decks: 0, participants: 1, answers: 1 });
    expect(await counts()).toEqual(before);
  });

  it('runs once through the migration runner, with the library index', async () => {
    const result = await runMigrations({ migrations: [migration010, migration011] });
    expect(result).toEqual({ applied: [10, 11], skipped: [] });
    expect(await runMigrations({ migrations: [migration010, migration011] })).toEqual({ applied: [], skipped: [10, 11] });
    for (const name of ['polls', 'presentations']) {
      const index = (await db.collection(name).indexes()).find((row) => row.name === LIBRARY_INDEX.name);
      expect(index?.key).toEqual({ workspaceId: 1, updatedAt: -1, _id: -1 });
    }
    await migration011.up({ db, connection: mongoose.connection, log: () => {} });
  });

  it('leaves copies that open, list and host like any deck (old /quiz links keep their id and code)', async () => {
    const opened = await server.request(`/api/presentations/${quizA}`, { headers: owner.headers });
    expect(opened.status).toBe(200);
    const deck = ((await opened.json()) as { data: any }).data;
    expect(deck.slides[0]).toMatchObject({ type: 'select_answer', kind: 'interactive', notes: '', media: null });

    const library = ((await (await server.request('/api/library', { headers: owner.headers })).json()) as { data: any }).data;
    expect(library.items.filter((item: any) => item.details.legacySource === 'quiz')).toHaveLength(3);

    const lobby = await server.request(`/api/presentations/${quizA}/host/open-lobby`, { method: 'POST', headers: owner.headers });
    expect(lobby.status).toBe(200);
    const byCode = await server.request(`/api/presentations/code/${deck.joinCode}`);
    expect(byCode.status).toBe(200);
    expect(((await byCode.json()) as { data: any }).data).toMatchObject({ presentationId: String(quizA), status: 'lobby' });
  });
});
