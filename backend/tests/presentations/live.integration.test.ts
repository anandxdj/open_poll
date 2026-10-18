/**
 * Presentations live-lifecycle integration test: the real `/api/presentations`
 * router on an Express app (port 0), real Mongo and Redis, live events read back
 * from the Redis `live:event` channel. Covers open lobby → two participants →
 * each of the seven built-in slide types (legacy fields and the generic
 * `payload`) → reveal → leaderboard → end, the content lifecycle with a
 * test-only registered type, and hydration of decks stored before the
 * registry's additive slide fields.
 *
 * Skipped unless TEST_MONGO_URI and TEST_REDIS_URL are both set. Point them at
 * dedicated test databases — never at a dev or shared instance (never 27017/6379).
 * The test deletes only the documents and keys it creates (plus this IP's
 * `rl:presentation-*` rate-limit counters in the test Redis DB).
 *
 *   docker run -d --name openpoll-test-redis -p 127.0.0.1:6390:6379 redis:7-alpine
 *   docker run -d --name openpoll-test-mongo -p 127.0.0.1:27117:27017 mongo:7
 *
 *   cd backend
 *   TEST_MONGO_URI='mongodb://127.0.0.1:27117/openpoll_w0a?directConnection=true' \
 *   TEST_REDIS_URL=redis://127.0.0.1:6390/1 \
 *   bun test tests/presentations/live.integration.test.ts
 *
 * The shared `redisClient` reads REDIS_URL when it is first imported. When an
 * earlier test file in the same `bun test` run imported it with another URL, this
 * file re-runs itself in a child process with REDIS_URL=TEST_REDIS_URL rather
 * than connect that client anywhere else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { z } from 'zod';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL;
const TEST_MONGO_URI = process.env.TEST_MONGO_URI;
const enabled = Boolean(TEST_REDIS_URL && TEST_MONGO_URI);

const previousRedisUrl = process.env.REDIS_URL;
if (enabled) process.env.REDIS_URL = TEST_REDIS_URL;
const { redisClient } = await import('../../src/common/config/redis');
if (enabled) {
  if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = previousRedisUrl;
}
const inProcess = enabled && redisClient.options?.url === TEST_REDIS_URL;

// App modules load after REDIS_URL is settled. Importing them opens no connection.
const express = (await import('express')).default;
const mongoose = (await import('mongoose')).default;
const presentationsRouter = (await import('../../src/modules/presentations/presentations.route')).default;
const { errorHandler } = await import('../../src/common/middlewares/errorHandler');
const { REALTIME_CHANNELS } = await import('../../src/common/realtime/events');
const { liveSeqKey } = await import('../../src/common/realtime/publish');
const { generateAccessToken } = await import('../../src/common/utils/jwt.utils');
const { UserModel } = await import('../../src/modules/auth/auth.model');
const { PresentationModel, PresentationParticipantModel, PresentationAnswerModel, PresentationSessionModel } =
  await import('../../src/modules/presentations/presentations.model');
const { commonSlideShape, defineSlideType, registerSlideType } = await import(
  '../../src/modules/presentations/slides'
);

describe.skipIf(!enabled || inProcess)('presentations live integration (isolated process)', () => {
  it('passes in a process whose Redis client points at TEST_REDIS_URL', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: `${import.meta.dir}/../..`,
      env: { ...process.env, REDIS_URL: TEST_REDIS_URL, MONGO_URI: TEST_MONGO_URI },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    expect(await child.exited).toBe(0);
  }, 90_000);
});

type Envelope = {
  v: number;
  presentationId: string;
  seq: number;
  type: string;
  payload: Record<string, any>;
  audience: string;
};

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

const DECK_SLIDES = [
  {
    type: 'select_answer',
    question: 'Capital of France?',
    notes: 'SPEAKER-NOTE: Paris since 508',
    options: [
      { text: 'Paris', isCorrect: true },
      { text: 'Lyon', isCorrect: false },
      { text: 'Nice', isCorrect: false },
    ],
    timeLimit: 20,
  },
  {
    type: 'type_answer',
    question: 'Largest planet?',
    acceptedAnswers: ['Jupiter'],
    timeLimit: 30,
    points: 500,
    scoreDependsOnTime: false,
    media: { url: 'https://cdn.example.com/jupiter.png', alt: 'Jupiter', key: 'uploads/jupiter.png' },
  },
  { type: 'wordcloud', question: 'One word for Mondays', maxEntries: 2 },
  { type: 'open_ended', question: 'Any feedback?' },
  { type: 'scales', question: 'Rate the talk', statements: ['Pace', 'Clarity'], minLabel: 'Low', maxLabel: 'High' },
  { type: 'ranking', question: 'Rank the letters', items: ['A', 'B', 'C'] },
  { type: 'leaderboard', question: 'Standings' },
];

describe.skipIf(!inProcess)('presentations live lifecycle (Mongo + Redis)', () => {
  let http: HttpServer;
  let baseUrl = '';
  let subscriber: ReturnType<typeof redisClient.duplicate>;
  const events: Envelope[] = [];
  const presentationIds: string[] = [];
  let userId = '';
  let accessToken = '';
  // The smoke test pins `redisClient.isOpen` to true; lift that while this file owns the client.
  let pinnedIsOpen: PropertyDescriptor | undefined;

  const api = async (method: string, path: string, body?: unknown, auth = true) => {
    const res = await fetch(`${baseUrl}/api/presentations${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const eventsOf = (pid: string, type: string) => events.filter((e) => e.presentationId === pid && e.type === type);
  const nextEvent = async (pid: string, type: string, count: number) => {
    await waitFor(() => eventsOf(pid, type).length >= count, `${type} #${count}`);
    return eventsOf(pid, type)[count - 1]!;
  };

  const createDeck = async (slides: unknown[]) => {
    const res = await api('POST', '/', { title: 'W0-A integration', slides });
    expect(res.status).toBe(201);
    presentationIds.push(res.body.data._id);
    return res.body.data as { _id: string; joinCode: string; slides: any[] };
  };

  beforeAll(async () => {
    pinnedIsOpen = Object.getOwnPropertyDescriptor(redisClient, 'isOpen');
    if (pinnedIsOpen) delete (redisClient as { isOpen?: boolean }).isOpen;
    if (!redisClient.isOpen) await redisClient.connect();
    await mongoose.connect(TEST_MONGO_URI!);

    for await (const batch of redisClient.scanIterator({ MATCH: 'rl:presentation-*' })) {
      if (batch.length) await redisClient.del(batch);
    }

    const user = await UserModel.create({
      email: `w0a-${new mongoose.Types.ObjectId().toString()}@example.test`,
      name: 'W0-A Host',
    });
    userId = String(user._id);
    accessToken = generateAccessToken({ id: userId, email: user.email, name: user.name, role: 'user' });

    subscriber = redisClient.duplicate();
    await subscriber.connect();
    await subscriber.subscribe(REALTIME_CHANNELS.liveEvent, (message: string) => {
      events.push(JSON.parse(message) as Envelope);
    });

    const app = express();
    app.use(express.json({ limit: '100kb' }));
    app.use('/api/presentations', presentationsRouter);
    app.use(errorHandler);
    http = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => http.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  }, 20_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => http?.close(() => resolve()));
    if (subscriber?.isOpen) await subscriber.close();
    for (const presentationId of presentationIds) {
      const sessionIds = (await PresentationSessionModel.find({ presentationId }).select('_id').lean()).map((s) =>
        String(s._id)
      );
      await Promise.all([
        PresentationModel.deleteOne({ _id: presentationId }),
        PresentationSessionModel.deleteMany({ presentationId }),
        PresentationParticipantModel.deleteMany({ presentationId }),
        PresentationAnswerModel.deleteMany({ presentationId }),
      ]);
      const keys: string[] = [liveSeqKey(presentationId)];
      for (const pattern of [`presentation:${presentationId}:*`, ...sessionIds.map((sid) => `psess:{${sid}}:*`)]) {
        for await (const batch of redisClient.scanIterator({ MATCH: pattern })) keys.push(...batch);
      }
      await redisClient.del(keys);
      await redisClient.sRem('buffer:active_presentation_distributions', presentationId);
    }
    if (userId) await UserModel.deleteOne({ _id: userId });
    await mongoose.disconnect();
    await redisClient.close();
    if (pinnedIsOpen) Object.defineProperty(redisClient, 'isOpen', pinnedIsOpen);
  }, 20_000);

  it('runs lobby → 2 participants → all seven types → reveal → leaderboard → end', async () => {
    const deck = await createDeck(DECK_SLIDES);
    const pid = deck._id;
    expect(deck.slides.map((s) => s.kind)).toEqual([
      'interactive',
      'interactive',
      'interactive',
      'interactive',
      'interactive',
      'interactive',
      'system',
    ]);
    expect(deck.slides[0].notes).toBe('SPEAKER-NOTE: Paris since 508');
    expect(deck.slides[1].media).toEqual({
      key: 'uploads/jupiter.png',
      url: 'https://cdn.example.com/jupiter.png',
      alt: 'Jupiter',
      layout: null,
    });

    expect((await api('POST', `/${pid}/host/open-lobby`)).status).toBe(200);
    expect((await nextEvent(pid, 'lobby:opened', 1)).payload).toEqual({ joinCode: deck.joinCode });
    const lobby = await api('GET', `/code/${deck.joinCode}`, undefined, false);
    expect(lobby.body.data).toMatchObject({ presentationId: pid, status: 'lobby', totalSlides: 7, currentSlideIndex: -1 });

    const ada = (await api('POST', `/${pid}/join`, { name: 'Ada' }, false)).body.data;
    const linus = (await api('POST', `/${pid}/join`, { name: 'Linus' }, false)).body.data;
    expect((await nextEvent(pid, 'participant:joined', 2)).payload.participantCount).toBe(2);

    const answerAs = (who: any, slideIndex: number, body: Record<string, unknown>) =>
      api('POST', `/${pid}/answer`, { participantId: who.participantId, participantToken: who.token, slideIndex, ...body }, false);

    // [Ada via legacy fields, Linus via the generic payload, expected distribution]
    const rounds: [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][] = [
      [
        { optionIndex: 0 },
        { optionIndex: 1 },
        {
          kind: 'options',
          counts: [1, 1, 0],
          options: [
            { text: 'Paris', isCorrect: true },
            { text: 'Lyon', isCorrect: false },
            { text: 'Nice', isCorrect: false },
          ],
        },
      ],
      [
        { text: 'Jupiter' },
        { text: 'saturn' },
        {
          kind: 'text',
          answers: [
            { text: 'jupiter', count: 1, isCorrect: true },
            { text: 'saturn', count: 1, isCorrect: false },
          ],
          acceptedAnswers: ['Jupiter'],
        },
      ],
      [
        { entries: ['Coffee', 'Tea'] },
        { entries: ['coffee'] },
        { kind: 'words', words: [{ text: 'Coffee', count: 2 }, { text: 'Tea', count: 1 }] },
      ],
      [
        { text: 'Great talk' },
        { text: 'great  talk' },
        { kind: 'responses', responses: [{ text: 'Great talk', count: 2 }] },
      ],
      [
        { ratings: [4, 5] },
        { ratings: [2, 3] },
        {
          kind: 'scales',
          statements: [
            { statement: 'Pace', average: 3, count: 2 },
            { statement: 'Clarity', average: 4, count: 2 },
          ],
          scaleMax: 5,
          minLabel: 'Low',
          maxLabel: 'High',
        },
      ],
      [
        { ranking: [2, 0, 1] },
        { ranking: [0, 2, 1] },
        {
          kind: 'ranking',
          items: [
            { text: 'A', points: 5, rank: 1 },
            { text: 'C', points: 5, rank: 2 },
            { text: 'B', points: 2, rank: 3 },
          ],
          voters: 2,
        },
      ],
    ];

    for (const [index, [adaAnswer, linusPayload, distribution]] of rounds.entries()) {
      expect((await api('POST', `/${pid}/host/advance`)).status).toBe(200);
      const started = await nextEvent(pid, 'question:started', index + 1);
      expect(started.audience).toBe('all');
      expect(started.payload.slide).toMatchObject({ slideIndex: index, totalSlides: 7, type: DECK_SLIDES[index]!.type });
      const wireSlide = JSON.stringify(started.payload.slide);
      expect(wireSlide).not.toContain('SPEAKER-NOTE');
      expect(wireSlide).not.toContain('isCorrect');
      expect(wireSlide).not.toContain('acceptedAnswers');
      expect(wireSlide).not.toContain('uploads/jupiter.png');

      expect((await answerAs(ada, index, adaAnswer)).status).toBe(200);
      expect((await answerAs(linus, index, { payload: linusPayload })).status).toBe(200);
      const duplicate = await answerAs(ada, index, adaAnswer);
      expect(duplicate.status).toBe(409);

      if (index === 0) {
        const host = (await api('GET', `/${pid}/host/state`)).body.data;
        expect(host.answeredCount).toBe(2);
        expect(host.liveDistribution).toMatchObject({ kind: 'options', counts: [1, 1, 0] });
        const received = eventsOf(pid, 'answer:received');
        expect(received.length).toBeGreaterThanOrEqual(2);
        expect(received.every((e) => e.audience === 'host')).toBe(true);
      }
      if (index === 1) {
        expect(started.payload.slide.media).toEqual({
          url: 'https://cdn.example.com/jupiter.png',
          alt: 'Jupiter',
          layout: null,
        });
      }

      expect((await api('POST', `/${pid}/host/reveal`)).status).toBe(200);
      const revealed = await nextEvent(pid, 'question:revealed', index + 1);
      expect(revealed.payload).toMatchObject({
        slideIndex: index,
        type: DECK_SLIDES[index]!.type,
        answeredCount: 2,
        participantCount: 2,
        isLastSlide: false,
      });
      expect(revealed.payload.distribution).toEqual(distribution);
    }

    const me = (await api('GET', `/${pid}/me?participantId=${ada.participantId}&token=${ada.token}`, undefined, false))
      .body.data;
    expect(me).toMatchObject({ name: 'Ada', correctCount: 2, rank: 1, presentationStatus: 'active' });
    expect(me.totalScore).toBeGreaterThan(1400);

    expect((await api('POST', `/${pid}/host/advance`)).status).toBe(200);
    const board = await nextEvent(pid, 'leaderboard:shown', 1);
    expect(board.payload.isLastSlide).toBe(true);
    expect(board.payload.leaderboard.map((e: any) => [e.name, e.rank, e.correctCount])).toEqual([
      ['Ada', 1, 2],
      ['Linus', 2, 0],
    ]);
    expect(board.payload.leaderboard[0].score).toBe(me.totalScore);
    expect((await api('POST', `/${pid}/host/reveal`)).body.message).toBe('Leaderboard slides have nothing to reveal');
    expect((await answerAs(ada, 6, { optionIndex: 0 })).body.message).toBe('This slide is no longer accepting answers');
    const onBoard = (await api('GET', `/code/${deck.joinCode}`, undefined, false)).body.data;
    expect(onBoard.currentSlide).toMatchObject({ slideIndex: 6, type: 'leaderboard', kind: 'system' });
    expect(onBoard.questionEndsAt).toBeUndefined();

    expect((await api('POST', `/${pid}/host/end`)).status).toBe(200);
    const ended = await nextEvent(pid, 'quiz:ended', 1);
    expect(ended.payload.participantCount).toBe(2);
    expect(ended.payload.leaderboard[0].name).toBe('Ada');

    const seqs = events.filter((e) => e.presentationId === pid).map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    await waitFor(async () => (await PresentationAnswerModel.countDocuments({ presentationId: pid })) === 12, 'answers');
    const adaDoc = await PresentationParticipantModel.findById(ada.participantId).lean();
    await waitFor(
      async () => (await PresentationParticipantModel.findById(ada.participantId).lean())?.score === me.totalScore,
      'participant score write-behind'
    );
    expect(adaDoc?.name).toBe('Ada');
    const stored = await PresentationAnswerModel.find({ presentationId: pid, participantId: linus.participantId })
      .sort({ slideIndex: 1 })
      .lean();
    expect(stored.map((a) => [a.slideIndex, a.optionIndex, a.text, a.payload])).toEqual([
      [0, 1, null, null],
      [1, null, 'saturn', null],
      [2, null, null, { entries: ['coffee'] }],
      [3, null, 'great  talk', null],
      [4, null, null, { ratings: [2, 3] }],
      [5, null, null, { ranking: [0, 2, 1] }],
    ]);
  }, 60_000);

  it('runs a content slide (test-only type): slide:shown, no answer window', async () => {
    const dispose = registerSlideType(
      defineSlideType<never, never>({
        type: 'test_banner',
        name: 'Test banner',
        kind: 'content',
        lifecycle: 'content',
        scored: false,
        schema: z.object({
          type: z.literal('test_banner'),
          ...commonSlideShape,
          content: z.object({ headline: z.string().min(1).max(80) }),
        }),
        sanitize: (slide) => ({ headline: (slide.content as { headline: string }).headline }),
        label: (slide) => (slide.content as { headline: string }).headline,
      })
    );
    try {
      const rejected = await api('POST', '/', { title: 'bad', slides: [{ type: 'test_banner', content: {} }] });
      expect(rejected.status).toBe(400);
      expect(rejected.body.message).toContain('slides.0.content.headline');

      const deck = await createDeck([
        { type: 'test_banner', notes: 'BANNER-NOTE', timeLimit: 0, content: { headline: 'Welcome!' } },
        DECK_SLIDES[0],
      ]);
      const pid = deck._id;
      expect(deck.slides.map((s) => [s.kind, s.timeLimit])).toEqual([
        ['content', 0],
        ['interactive', 20],
      ]);

      await api('POST', `/${pid}/host/open-lobby`);
      const ada = (await api('POST', `/${pid}/join`, { name: 'Ada' }, false)).body.data;
      const advanced = await api('POST', `/${pid}/host/advance`);
      expect(advanced.body.data).toMatchObject({ status: 'active', currentSlideIndex: 0, questionEndsAt: null });

      const shown = await nextEvent(pid, 'slide:shown', 1);
      expect(shown.audience).toBe('all');
      expect(shown.payload.slide).toEqual({
        slideIndex: 0,
        totalSlides: 2,
        type: 'test_banner',
        kind: 'content',
        scored: false,
        headline: 'Welcome!',
        media: null,
        layout: null,
      });
      expect(JSON.stringify(shown)).not.toContain('BANNER-NOTE');
      expect(eventsOf(pid, 'question:started')).toEqual([]);

      const answer = await api(
        'POST',
        `/${pid}/answer`,
        { participantId: ada.participantId, participantToken: ada.token, slideIndex: 0, payload: { x: 1 } },
        false
      );
      expect(answer.status).toBe(400);
      expect(answer.body.message).toBe('This slide is no longer accepting answers');
      expect((await api('POST', `/${pid}/host/reveal`)).body.message).toBe('Test banner slides have nothing to reveal');

      const lookup = (await api('GET', `/code/${deck.joinCode}`, undefined, false)).body.data;
      expect(lookup.currentSlide).toEqual(shown.payload.slide);
      expect(lookup.questionStartedAt).toBeUndefined();

      await api('POST', `/${pid}/host/advance`);
      expect((await nextEvent(pid, 'question:started', 1)).payload.slide.slideIndex).toBe(1);
    } finally {
      dispose();
    }
  }, 30_000);

  it('hydrates the additive slide fields on decks stored before the registry', async () => {
    const _id = new mongoose.Types.ObjectId();
    presentationIds.push(String(_id));
    await PresentationModel.collection.insertOne({
      _id,
      creatorId: userId,
      title: 'Legacy deck',
      joinCode: `L${Date.now()}`.slice(0, 12),
      status: 'draft',
      currentSlideIndex: -1,
      slides: [
        {
          _id: new mongoose.Types.ObjectId(),
          type: 'scales',
          question: 'Old scales',
          options: [],
          acceptedAnswers: [],
          statements: ['One'],
          minLabel: '',
          maxLabel: '',
          scaleMax: 5,
          items: [],
          maxEntries: 3,
          timeLimit: 30,
          points: 1000,
          scoreDependsOnTime: true,
        },
        { _id: new mongoose.Types.ObjectId(), type: 'leaderboard', question: 'Board', timeLimit: 30 },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await api('GET', `/${_id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.slides.map((s: any) => [s.type, s.kind, s.notes, s.media, s.layout, s.content, s.config])).toEqual([
      ['scales', 'interactive', '', null, null, null, null],
      ['leaderboard', 'system', '', null, null, null, null],
    ]);
  });
});
