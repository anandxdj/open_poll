import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import {
  PresentationAnswerModel,
  PresentationSessionModel,
} from '../../src/modules/presentations/presentations.model';
import { createVerifiedUser, type TestUser } from './fixtures';
import { describeIntegration, resetTestData, startTestServer, type TestServer } from './harness';

/**
 * The four advanced interactive types (guess_number, hundred_points, grid_2x2,
 * pin_on_image) through the real app: deck CRUD with their schemas, sanitized
 * participant slides, answers over the HTTP answer route (valid, malformed,
 * duplicate), host results, reveal, durable answers, scores and exports.
 */

type Body<T = any> = { success: boolean; message: string; code?: string; data: T };

const waitFor = async (check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

const IMAGE_URL = 'https://images.example.com/map.png';

// Flat points keep the scores independent of the clock.
const GUESS = {
  type: 'guess_number',
  question: 'How many moons does Jupiter have?',
  notes: 'SECRET-NOTE guess',
  timeLimit: 60,
  points: 500,
  scoreDependsOnTime: false,
  config: { min: 0, max: 100, step: 1, correct: 79, tolerance: 3 },
};
const POINTS = {
  type: 'hundred_points',
  question: 'Where should we invest?',
  notes: 'SECRET-NOTE points',
  timeLimit: 0,
  config: { items: ['Docs', 'Tests', 'Speed'] },
};
const GRID = {
  type: 'grid_2x2',
  question: 'Place the ideas',
  notes: 'SECRET-NOTE grid',
  timeLimit: 0,
  config: {
    items: ['Dark mode', 'Offline'],
    x: { label: 'Effort', min: 0, max: 10 },
    y: { label: 'Impact', min: 0, max: 10 },
  },
};
const PIN = {
  type: 'pin_on_image',
  question: 'Where is Paris?',
  notes: 'SECRET-NOTE pin',
  timeLimit: 60,
  points: 300,
  scoreDependsOnTime: false,
  content: { url: IMAGE_URL, alt: 'Map of France' },
  config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } },
};

describeIntegration('advanced slide types over HTTP', () => {
  let server: TestServer;
  let host: TestUser;

  const call = async <T = any>(
    method: string,
    path: string,
    options: { user?: TestUser; body?: unknown } = {}
  ) => {
    const res = await server.request(`/api/presentations${path}`, {
      method,
      headers: options.user?.headers ?? {},
      body: options.body,
    });
    return { status: res.status, body: (await res.json()) as Body<T> };
  };

  const createDeck = async (slides: unknown[]) => {
    const res = await call('POST', '/', { user: host, body: { title: 'Advanced deck', slides } });
    expect(res.status).toBe(201);
    return res.body.data as { _id: string; joinCode: string; slides: Record<string, any>[] };
  };

  const hostCommand = (pid: string, command: string, body?: unknown) =>
    call('POST', `/${pid}/host/${command}`, { user: host, body });

  const join = async (pid: string, name: string) => (await call('POST', `/${pid}/join`, { body: { name } })).body.data;

  const answer = (pid: string, who: { participantId: string; token: string }, slideIndex: number, payload: unknown) =>
    call('POST', `/${pid}/answer`, {
      body: { participantId: who.participantId, participantToken: who.token, slideIndex, payload },
    });

  const liveState = async (pid: string, who: { participantId: string; token: string }) =>
    (await call('GET', `/${pid}/live-state?participantId=${who.participantId}&token=${who.token}`)).body.data;

  const hostState = async (pid: string) => (await call('GET', `/${pid}/host/state`, { user: host })).body.data;

  beforeAll(async () => {
    server = await startTestServer();
  }, 20_000);

  beforeEach(async () => {
    await resetTestData();
    host = await createVerifiedUser({ name: 'Host' });
  });

  afterAll(async () => {
    await resetTestData();
    await server?.close();
  });

  it('stores the four types with their settings and rejects invalid ones', async () => {
    const deck = await createDeck([GUESS, POINTS, GRID, PIN]);
    expect(deck.slides.map((s) => [s.type, s.kind])).toEqual([
      ['guess_number', 'interactive'],
      ['hundred_points', 'interactive'],
      ['grid_2x2', 'interactive'],
      ['pin_on_image', 'interactive'],
    ]);
    expect(deck.slides[0]!.config).toEqual({ min: 0, max: 100, step: 1, correct: 79, tolerance: 3 });
    expect(deck.slides[1]!).toMatchObject({ config: { items: ['Docs', 'Tests', 'Speed'] }, points: 0 });
    expect(deck.slides[3]!).toMatchObject({
      content: { key: null, url: IMAGE_URL, alt: 'Map of France' },
      config: { region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 } },
    });

    const bad = (slide: unknown) => call('POST', '/', { user: host, body: { title: 'Bad', slides: [slide] } });
    expect((await bad({ ...POINTS, config: { items: ['Only one'] } })).status).toBe(400);
    expect((await bad({ ...GUESS, config: { ...GUESS.config, max: -1 } })).status).toBe(400);
    expect((await bad({ ...GUESS, timeLimit: 0 })).status).toBe(400);
    expect((await bad({ ...GRID, config: { ...GRID.config, x: { label: 'Effort', min: 5, max: 5 } } })).status).toBe(400);
    expect((await bad({ ...PIN, content: { url: 'http://insecure.example.com/a.png', alt: 'x' } })).status).toBe(400);
    expect((await bad({ ...PIN, config: { region: { x: 0.9, y: 0.2, width: 0.5, height: 0.2 } } })).status).toBe(400);
  });

  it('runs all four types: sanitized slides, answers, rejections, results, scores and exports', async () => {
    const deck = await createDeck([GUESS, POINTS, GRID, PIN]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    const linus = await join(pid, 'Linus');

    // ---- guess_number ----
    await hostCommand(pid, 'advance');
    const guessSlide = (await liveState(pid, ada)).current.slide;
    expect(guessSlide).toMatchObject({
      type: 'guess_number',
      scored: true,
      config: { min: 0, max: 100, step: 1 },
      question: GUESS.question,
    });
    const leaks = (slide: unknown, ...needles: string[]) => {
      const json = JSON.stringify(slide);
      for (const needle of ['SECRET-NOTE', 'correct', 'tolerance', 'region', ...needles]) {
        expect(json).not.toContain(needle);
      }
    };
    leaks(guessSlide, '79');

    for (const payload of [{}, { value: 101 }, { value: 10.5 }, { value: 'ten' }]) {
      expect((await answer(pid, ada, 0, payload)).status).toBe(400);
    }
    expect((await answer(pid, ada, 0, { value: 80 })).status).toBe(200);
    expect((await answer(pid, linus, 0, { value: 20 })).status).toBe(200);
    expect((await answer(pid, ada, 0, { value: 79 })).status).toBe(409);
    expect((await hostState(pid)).distributions[deck.slides[0]!._id].distribution).toMatchObject({
      kind: 'guess_number',
      count: 2,
      mean: 50,
      median: 50,
      correct: 79,
      correctCount: 1,
    });
    await hostCommand(pid, 'reveal');
    const revealedGuess = (await liveState(pid, linus)).current;
    expect(revealedGuess).toMatchObject({ phase: 'revealed', results: { scored: true, answeredCount: 2 } });
    expect(revealedGuess.results.distribution).toMatchObject({ kind: 'guess_number', correct: 79, tolerance: 3 });

    // ---- hundred_points ----
    await hostCommand(pid, 'advance');
    const pointsSlide = (await liveState(pid, ada)).current.slide;
    expect(pointsSlide).toMatchObject({ type: 'hundred_points', scored: false, config: { items: ['Docs', 'Tests', 'Speed'] } });
    leaks(pointsSlide);
    for (const payload of [
      { points: [50, 50, 1] },
      { points: [50, 50] },
      { points: [60, 50, -10] },
      { points: [33.5, 33.5, 33] },
      { points: 'all' },
    ]) {
      expect((await answer(pid, ada, 1, payload)).status).toBe(400);
    }
    expect((await answer(pid, ada, 1, { points: [50, 50, 0] })).status).toBe(200);
    expect((await answer(pid, linus, 1, { points: [10, 20, 70] })).status).toBe(200);
    await hostCommand(pid, 'reveal');
    expect((await liveState(pid, ada)).current.results.distribution).toEqual({
      kind: 'hundred_points',
      items: [
        { text: 'Docs', total: 60, average: 30 },
        { text: 'Tests', total: 70, average: 35 },
        { text: 'Speed', total: 70, average: 35 },
      ],
      voters: 2,
    });

    // ---- grid_2x2 ----
    await hostCommand(pid, 'advance');
    leaks((await liveState(pid, ada)).current.slide);
    for (const positions of [
      [{ x: 1, y: 1 }],
      [{ x: 1, y: 1 }, { x: 1, y: 11 }],
      [{ x: -1, y: 1 }, { x: 1, y: 1 }],
      [{ x: 1 }, { x: 1, y: 1 }],
    ]) {
      expect((await answer(pid, ada, 2, { positions })).status).toBe(400);
    }
    expect((await answer(pid, ada, 2, { positions: [{ x: 2, y: 8 }, { x: 9, y: 3 }] })).status).toBe(200);
    expect((await answer(pid, linus, 2, { positions: [{ x: 4, y: 6 }, { x: 7, y: 1 }] })).status).toBe(200);
    await hostCommand(pid, 'reveal');
    expect((await liveState(pid, linus)).current.results.distribution).toMatchObject({
      kind: 'grid_2x2',
      x: { label: 'Effort', min: 0, max: 10 },
      items: [
        { text: 'Dark mode', x: 3, y: 7, count: 2 },
        { text: 'Offline', x: 8, y: 2, count: 2 },
      ],
      voters: 2,
    });

    // ---- pin_on_image ----
    await hostCommand(pid, 'advance');
    const pinSlide = (await liveState(pid, ada)).current.slide;
    expect(pinSlide).toMatchObject({
      type: 'pin_on_image',
      scored: true,
      content: { url: IMAGE_URL, alt: 'Map of France' },
    });
    leaks(pinSlide, '0.4');
    for (const pin of [{}, { x: 0.5 }, { x: 1.2, y: 0.5 }, { x: 0.5, y: -0.1 }, { x: 'a', y: 0.5 }]) {
      expect((await answer(pid, ada, 3, pin)).status).toBe(400);
    }
    expect((await answer(pid, ada, 3, { x: 0.5, y: 0.3 })).status).toBe(200);
    expect((await answer(pid, linus, 3, { x: 0.1, y: 0.9 })).status).toBe(200);
    await hostCommand(pid, 'reveal');
    const pinResults = (await liveState(pid, ada)).current.results.distribution;
    expect(pinResults).toMatchObject({
      kind: 'pin_on_image',
      count: 2,
      pins: [
        { x: 0.1, y: 0.9 },
        { x: 0.5, y: 0.3 },
      ],
      region: { x: 0.4, y: 0.2, width: 0.2, height: 0.2 },
      inRegion: 1,
    });

    // Scores: Ada 500 (guess) + 300 (pin), Linus none.
    const me = (pid: string, who: { participantId: string; token: string }) =>
      call('GET', `/${pid}/me?participantId=${who.participantId}&token=${who.token}`).then((r) => r.body.data);
    expect(await me(pid, ada)).toMatchObject({ totalScore: 800, correctCount: 2 });
    expect(await me(pid, linus)).toMatchObject({ totalScore: 0, correctCount: 0 });

    // The answers reach Mongo with their payloads; the ended session keeps the distributions.
    await waitFor(async () => (await PresentationAnswerModel.countDocuments({ presentationId: pid })) === 8, 'answers');
    const stored = await PresentationAnswerModel.find({ participantId: ada.participantId }).sort({ slideIndex: 1 }).lean();
    expect(stored.map((a) => [a.isCorrect, a.score, a.payload])).toEqual([
      [true, 500, { value: 80 }],
      [false, 0, { points: [50, 50, 0] }],
      [false, 0, { positions: [{ x: 2, y: 8 }, { x: 9, y: 3 }] }],
      [true, 300, { x: 0.5, y: 0.3 }],
    ]);
    const ended = await hostCommand(pid, 'end');
    expect(ended.body.data).toMatchObject({ status: 'ended' });
    const session = await PresentationSessionModel.findOne({ presentationId: pid }).lean();
    expect(session!.slideStats.map((s) => [s.type, s.answeredCount, (s.distribution as any).kind])).toEqual([
      ['guess_number', 2, 'guess_number'],
      ['hundred_points', 2, 'hundred_points'],
      ['grid_2x2', 2, 'grid_2x2'],
      ['pin_on_image', 2, 'pin_on_image'],
    ]);
  });

  it('ungraded guess and pin slides collect results without scoring', async () => {
    const deck = await createDeck([
      { ...GUESS, points: 0, config: { ...GUESS.config, correct: null } },
      { ...PIN, points: 0, config: { region: null } },
    ]);
    const pid = deck._id;
    await hostCommand(pid, 'open-lobby');
    const ada = await join(pid, 'Ada');
    await hostCommand(pid, 'advance');
    expect((await liveState(pid, ada)).current.slide).toMatchObject({ scored: false });
    expect((await answer(pid, ada, 0, { value: 79 })).status).toBe(200);
    await hostCommand(pid, 'advance');
    expect((await answer(pid, ada, 1, { x: 0.5, y: 0.3 })).status).toBe(200);
    await hostCommand(pid, 'reveal');
    expect((await liveState(pid, ada)).current.results.distribution).toMatchObject({ count: 1, region: null, inRegion: null });
    const state = await hostState(pid);
    expect(state.distributions[deck.slides[0]!._id].distribution).toMatchObject({ count: 1, correct: null, correctCount: null });
    const mine = await call('GET', `/${pid}/me?participantId=${ada.participantId}&token=${ada.token}`);
    expect(mine.body.data).toMatchObject({ totalScore: 0, correctCount: 0 });
  });
});
