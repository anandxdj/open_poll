import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import {
  PresentationService,
  computeSlideDistributionHelper,
} from '../../src/modules/presentations/presentations.service';
import {
  createPresentationSchema,
  submitPresentationAnswerSchema,
} from '../../src/modules/presentations/presentations.schema';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, type FakeRedis } from './harness';

/**
 * Golden (characterization) tests for the seven built-in slide types.
 *
 * Written against the pre-registry service and kept unchanged through the
 * registry refactor: they pin the participant-facing slide payload (sanitize),
 * answer acceptance and validation messages, the Redis distribution/result
 * writes, reveal distributions and speed scoring, all through the public
 * `PresentationService` facade. Wire shapes are compared after a JSON round
 * trip, which is what clients receive.
 *
 * Additive fields the registry plan introduces are allowed but must be the only
 * difference: participant slides may gain `kind`, `media`, `layout`; parsed
 * slides may gain `notes`, `media`, `layout`, `content`, `config`.
 */

const T0 = new Date('2026-03-02T09:00:00.000Z').getTime();
const at = (ms: number) => setSystemTime(new Date(T0 + ms));

const wire = <T>(value: T): any => JSON.parse(JSON.stringify(value));

const ADDITIVE_PARTICIPANT_KEYS = ['kind', 'media', 'layout'];
const ADDITIVE_SLIDE_KEYS = ['notes', 'media', 'layout', 'content', 'config'];

/** Exact match on the legacy keys; any other key must be a sanctioned additive field. */
const expectLegacyShape = (actual: unknown, expected: Record<string, unknown>, additive: string[]) => {
  const value = wire(actual) as Record<string, unknown>;
  const legacy = Object.fromEntries(Object.keys(expected).map((key) => [key, value[key]]));
  expect(legacy).toEqual(expected);
  const unexpected = Object.keys(value).filter((key) => !(key in expected) && !additive.includes(key));
  expect(unexpected).toEqual([]);
};

const DECK = {
  title: 'Golden deck',
  creatorId: OWNER_ID,
  joinCode: '424242',
  slides: [
    {
      type: 'select_answer',
      question: 'Capital of France?',
      options: [
        { text: 'Paris', isCorrect: true },
        { text: 'Lyon', isCorrect: false },
        { text: 'Nice', isCorrect: false },
      ],
      timeLimit: 20,
      points: 1000,
      scoreDependsOnTime: true,
    },
    {
      type: 'type_answer',
      question: 'Largest planet?',
      acceptedAnswers: ['Jupiter', 'The  Jupiter'],
      timeLimit: 30,
      points: 500,
      scoreDependsOnTime: false,
    },
    { type: 'wordcloud', question: 'One word for Mondays', maxEntries: 2, timeLimit: 30 },
    { type: 'open_ended', question: 'Any feedback?', timeLimit: 60 },
    {
      type: 'scales',
      question: 'Rate the talk',
      statements: ['Pace', 'Clarity'],
      minLabel: 'Low',
      maxLabel: 'High',
      scaleMax: 5,
      timeLimit: 30,
    },
    { type: 'ranking', question: 'Rank the letters', items: ['A', 'B', 'C'], timeLimit: 30 },
    { type: 'leaderboard', question: 'Standings' },
  ],
};

const LEGACY_DEFAULTS = {
  options: [],
  statements: [],
  minLabel: '',
  maxLabel: '',
  scaleMax: 5,
  items: [],
  maxEntries: 3,
};

const EXPECTED_PARTICIPANT_SLIDES: Record<number, Record<string, unknown>> = {
  0: {
    ...LEGACY_DEFAULTS,
    slideIndex: 0,
    totalSlides: 7,
    type: 'select_answer',
    scored: true,
    question: 'Capital of France?',
    options: [{ text: 'Paris' }, { text: 'Lyon' }, { text: 'Nice' }],
    timeLimit: 20,
    points: 1000,
    scoreDependsOnTime: true,
  },
  1: {
    ...LEGACY_DEFAULTS,
    slideIndex: 1,
    totalSlides: 7,
    type: 'type_answer',
    scored: true,
    question: 'Largest planet?',
    timeLimit: 30,
    points: 500,
    scoreDependsOnTime: false,
  },
  2: {
    ...LEGACY_DEFAULTS,
    slideIndex: 2,
    totalSlides: 7,
    type: 'wordcloud',
    scored: false,
    question: 'One word for Mondays',
    maxEntries: 2,
    timeLimit: 30,
    points: 1000,
    scoreDependsOnTime: true,
  },
  3: {
    ...LEGACY_DEFAULTS,
    slideIndex: 3,
    totalSlides: 7,
    type: 'open_ended',
    scored: false,
    question: 'Any feedback?',
    timeLimit: 60,
    points: 1000,
    scoreDependsOnTime: true,
  },
  4: {
    ...LEGACY_DEFAULTS,
    slideIndex: 4,
    totalSlides: 7,
    type: 'scales',
    scored: false,
    question: 'Rate the talk',
    statements: ['Pace', 'Clarity'],
    minLabel: 'Low',
    maxLabel: 'High',
    scaleMax: 5,
    timeLimit: 30,
    points: 1000,
    scoreDependsOnTime: true,
  },
  5: {
    ...LEGACY_DEFAULTS,
    slideIndex: 5,
    totalSlides: 7,
    type: 'ranking',
    scored: false,
    question: 'Rank the letters',
    items: ['A', 'B', 'C'],
    timeLimit: 30,
    points: 1000,
    scoreDependsOnTime: true,
  },
};

let redis: FakeRedis;
let models: ReturnType<typeof installModelStubs>;
let restoreRedis: () => void;

beforeEach(() => {
  const fake = installFakeRedis();
  redis = fake.redis;
  restoreRedis = fake.restore;
  models = installModelStubs();
  at(0);
});

afterEach(async () => {
  await flush();
  models.restore();
  restoreRedis();
  setSystemTime();
});

const key = (pid: string, name: string, slide?: number) =>
  slide === undefined ? `presentation:${pid}:${name}` : `presentation:${pid}:${name}:${slide}`;

/** Opens the lobby on a fresh copy of DECK and joins Ada then Linus. */
async function liveDeck(overrides: Partial<typeof DECK> = {}) {
  const deck = models.addPresentation({ ...structuredClone(DECK), ...overrides });
  const pid = String(deck._id);
  await PresentationService.openLobby(pid, OWNER_ID);
  const ada = await PresentationService.joinPresentation(pid, { name: 'Ada' });
  const linus = await PresentationService.joinPresentation(pid, { name: 'Linus' });
  return { deck, pid, ada, linus };
}

type Joined = Awaited<ReturnType<typeof PresentationService.joinPresentation>>;

const answer = (pid: string, who: Joined, slideIndex: number, body: Record<string, unknown>) =>
  PresentationService.submitAnswer(pid, {
    participantId: who.participantId,
    participantToken: who.token,
    slideIndex,
    ...body,
  } as any);

const expectApiError = async (promise: Promise<unknown>, statusCode: number, message: string) => {
  let caught: any;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect({ statusCode: caught.statusCode, message: caught.message }).toEqual({ statusCode, message });
};

// ---------------------------------------------------------------------------
// Full deck walk-through: one golden per slide type
// ---------------------------------------------------------------------------

describe('golden: full deck run through the facade', () => {
  it('pins sanitize, accept, distribution and scoring for all seven types', async () => {
    const { deck, pid, ada, linus } = await liveDeck();
    expect(redis.lastEvent('lobby:opened')?.payload).toEqual({ joinCode: '424242' });
    expect(redis.events('participant:joined').map((e) => e.payload)).toEqual([
      { participantId: ada.participantId, name: 'Ada', participantCount: 1 },
      { participantId: linus.participantId, name: 'Linus', participantCount: 2 },
    ]);

    // ---- 0: select_answer (speed scored) ----
    at(0);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    const started0 = redis.lastEvent('question:started')!.payload;
    expectLegacyShape(started0.slide, EXPECTED_PARTICIPANT_SLIDES[0]!, ADDITIVE_PARTICIPANT_KEYS);
    expect(started0.startedAt).toBe(new Date(T0).toISOString());
    expect(started0.endsAt).toBe(new Date(T0 + 20_000).toISOString());
    expect(started0.serverNow).toBe(new Date(T0).toISOString());

    at(5_000);
    expect(await answer(pid, ada, 0, { optionIndex: 0 })).toEqual({ accepted: true });
    at(6_000);
    expect(await answer(pid, linus, 0, { optionIndex: 1 })).toEqual({ accepted: true });
    expect(redis.hash(key(pid, 'dist', 0))).toEqual({ '0': '1', '1': '1' });
    expect(redis.hash(key(pid, 'results', 0))).toEqual({
      [ada.participantId]: JSON.stringify({ isCorrect: true, score: 875, scored: true }),
      [linus.participantId]: JSON.stringify({ isCorrect: false, score: 0, scored: true }),
    });
    expect(redis.events('answer:received').map((e) => e.payload)).toEqual([
      { slideIndex: 0, answeredCount: 1 },
      { slideIndex: 0, answeredCount: 2 },
    ]);
    expect(redis.members('buffer:active_presentation_distributions')).toEqual([pid]);

    at(21_000);
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload).toEqual({
      slideIndex: 0,
      question: 'Capital of France?',
      type: 'select_answer',
      scored: true,
      distribution: {
        kind: 'options',
        counts: [1, 1, 0],
        options: [
          { text: 'Paris', isCorrect: true },
          { text: 'Lyon', isCorrect: false },
          { text: 'Nice', isCorrect: false },
        ],
      },
      answeredCount: 2,
      participantCount: 2,
      isLastSlide: false,
      auto: true,
    });

    // ---- 1: type_answer (flat points) ----
    at(30_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expectLegacyShape(
      redis.lastEvent('question:started')!.payload.slide,
      EXPECTED_PARTICIPANT_SLIDES[1]!,
      ADDITIVE_PARTICIPANT_KEYS,
    );
    at(55_000);
    await answer(pid, ada, 1, { text: 'JUPITER' });
    await answer(pid, linus, 1, { text: 'Saturn' });
    expect(redis.hash(key(pid, 'dist', 1))).toEqual({ jupiter: '1', saturn: '1' });
    expect(JSON.parse(redis.hash(key(pid, 'results', 1))[ada.participantId]!)).toEqual({
      isCorrect: true,
      score: 500,
      scored: true,
    });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toEqual({
      kind: 'text',
      answers: [
        { text: 'jupiter', count: 1, isCorrect: true },
        { text: 'saturn', count: 1, isCorrect: false },
      ],
      acceptedAnswers: ['Jupiter', 'The  Jupiter'],
    });

    // ---- 2: wordcloud (unscored, entries capped by maxEntries before dedupe) ----
    at(60_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expectLegacyShape(
      redis.lastEvent('question:started')!.payload.slide,
      EXPECTED_PARTICIPANT_SLIDES[2]!,
      ADDITIVE_PARTICIPANT_KEYS,
    );
    await answer(pid, ada, 2, { entries: ['Coffee', 'coffee ', 'Sleep'] });
    await answer(pid, linus, 2, { text: 'COFFEE' });
    expect(redis.hash(key(pid, 'dist', 2))).toEqual({ coffee: '2' });
    expect(redis.hash(key(pid, 'disp', 2))).toEqual({ coffee: 'Coffee' });
    expect(JSON.parse(redis.hash(key(pid, 'results', 2))[linus.participantId]!)).toEqual({
      isCorrect: false,
      score: 0,
      scored: false,
    });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    const revealed2 = redis.lastEvent('question:revealed')!.payload;
    expect(revealed2.scored).toBe(false);
    expect(revealed2.distribution).toEqual({ kind: 'words', words: [{ text: 'Coffee', count: 2 }] });

    // ---- 3: open_ended ----
    at(90_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expectLegacyShape(
      redis.lastEvent('question:started')!.payload.slide,
      EXPECTED_PARTICIPANT_SLIDES[3]!,
      ADDITIVE_PARTICIPANT_KEYS,
    );
    await answer(pid, ada, 3, { text: 'Great  talk' });
    await answer(pid, linus, 3, { text: 'great talk' });
    expect(redis.hash(key(pid, 'dist', 3))).toEqual({ 'great talk': '2' });
    expect(redis.hash(key(pid, 'disp', 3))).toEqual({ 'great talk': 'Great  talk' });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toEqual({
      kind: 'responses',
      responses: [{ text: 'Great  talk', count: 2 }],
    });

    // ---- 4: scales ----
    at(160_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expectLegacyShape(
      redis.lastEvent('question:started')!.payload.slide,
      EXPECTED_PARTICIPANT_SLIDES[4]!,
      ADDITIVE_PARTICIPANT_KEYS,
    );
    await answer(pid, ada, 4, { ratings: [4, 5] });
    await answer(pid, linus, 4, { ratings: [3, 4] });
    expect(redis.hash(key(pid, 'dist', 4))).toEqual({
      's0:sum': '7',
      's0:count': '2',
      's1:sum': '9',
      's1:count': '2',
    });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toEqual({
      kind: 'scales',
      statements: [
        { statement: 'Pace', average: 3.5, count: 2 },
        { statement: 'Clarity', average: 4.5, count: 2 },
      ],
      scaleMax: 5,
      minLabel: 'Low',
      maxLabel: 'High',
    });

    // ---- 5: ranking (Borda) ----
    at(200_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expectLegacyShape(
      redis.lastEvent('question:started')!.payload.slide,
      EXPECTED_PARTICIPANT_SLIDES[5]!,
      ADDITIVE_PARTICIPANT_KEYS,
    );
    await answer(pid, ada, 5, { ranking: [2, 0, 1] });
    await answer(pid, linus, 5, { ranking: [0, 2, 1] });
    expect(redis.hash(key(pid, 'dist', 5))).toEqual({ '0': '5', '1': '2', '2': '5', voters: '2' });
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload).toMatchObject({
      slideIndex: 5,
      isLastSlide: false,
      distribution: {
        kind: 'ranking',
        items: [
          { text: 'A', points: 5, rank: 1 },
          { text: 'C', points: 5, rank: 2 },
          { text: 'B', points: 2, rank: 3 },
        ],
        voters: 2,
      },
    });

    // ---- 6: leaderboard (no timer, no answers) ----
    at(240_000);
    const startedBefore = redis.events('question:started').length;
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(redis.events('question:started').length).toBe(startedBefore);
    expect(deck.questionStartedAt).toBeNull();
    expect(deck.questionEndsAt).toBeNull();
    const standings = [
      { participantId: ada.participantId, name: 'Ada', score: 1375, correctCount: 2, rank: 1 },
      { participantId: linus.participantId, name: 'Linus', score: 0, correctCount: 0, rank: 2 },
    ];
    expect(redis.lastEvent('leaderboard:shown')!.payload).toEqual({
      slideIndex: 6,
      leaderboard: standings,
      participantCount: 2,
      isLastSlide: true,
    });
    await expectApiError(answer(pid, ada, 6, { optionIndex: 0 }), 400, 'This slide is no longer accepting answers');
    await expectApiError(
      PresentationService.revealCurrentSlide(pid, OWNER_ID),
      400,
      'Leaderboard slides have nothing to reveal',
    );

    // ---- end ----
    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(redis.lastEvent('quiz:ended')!.payload).toEqual({ leaderboard: standings, participantCount: 2 });
    expect(deck.status).toBe('ended');

    // ---- write-behind: answers + participant totals ----
    await flush();
    const persisted = models.answers
      .filter((a) => String(a.participantId) === ada.participantId)
      .map(({ slideIndex, optionIndex, text, payload, isCorrect, score, timeMs }) => ({
        slideIndex,
        optionIndex,
        text,
        payload,
        isCorrect,
        score,
        timeMs,
      }));
    expect(wire(persisted)).toEqual([
      { slideIndex: 0, optionIndex: 0, text: null, payload: null, isCorrect: true, score: 875, timeMs: 5_000 },
      { slideIndex: 1, optionIndex: null, text: 'JUPITER', payload: null, isCorrect: true, score: 500, timeMs: 25_000 },
      {
        slideIndex: 2,
        optionIndex: null,
        text: null,
        payload: { entries: ['Coffee', 'coffee ', 'Sleep'] },
        isCorrect: false,
        score: 0,
        timeMs: 0,
      },
      { slideIndex: 3, optionIndex: null, text: 'Great  talk', payload: null, isCorrect: false, score: 0, timeMs: 0 },
      { slideIndex: 4, optionIndex: null, text: null, payload: { ratings: [4, 5] }, isCorrect: false, score: 0, timeMs: 0 },
      { slideIndex: 5, optionIndex: null, text: null, payload: { ranking: [2, 0, 1] }, isCorrect: false, score: 0, timeMs: 0 },
    ]);
    const linusWordcloud = models.answers.find(
      (a) => String(a.participantId) === linus.participantId && a.slideIndex === 2,
    );
    expect(linusWordcloud?.payload).toEqual({ entries: ['COFFEE'] });
    const adaRecord = models.participants.find((p) => String(p._id) === ada.participantId)!;
    expect({ score: adaRecord.score, correctCount: adaRecord.correctCount }).toEqual({ score: 1375, correctCount: 2 });
    expect(redis.zset(key(pid, 'scores'))).toEqual({
      [ada.participantId]: 1375,
      [linus.participantId]: 0,
    });
    expect(redis.hash(key(pid, 'correct'))).toEqual({ [ada.participantId]: '2' });
  });
});

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

describe('golden: participant slide payload (sanitize)', () => {
  it('code lookup carries the same sanitized slide and timing for a live timed slide', async () => {
    const { pid } = await liveDeck();
    const lobby = await PresentationService.getPresentationByCode(' 424242 ');
    expect(wire(lobby)).toEqual({
      quizId: pid,
      presentationId: pid,
      title: 'Golden deck',
      status: 'lobby',
      totalSlides: 7,
      currentSlideIndex: -1,
      serverNow: new Date(T0).toISOString(),
    });

    await PresentationService.advanceSlide(pid, OWNER_ID, 4);
    const live = wire(await PresentationService.getPresentationByCode('424242'));
    expectLegacyShape(live.currentSlide, EXPECTED_PARTICIPANT_SLIDES[4]!, ADDITIVE_PARTICIPANT_KEYS);
    expect(live.questionStartedAt).toBe(new Date(T0).toISOString());
    expect(live.questionEndsAt).toBe(new Date(T0 + 30_000).toISOString());
    expect(live.status).toBe('active');
    expect(live.currentSlideIndex).toBe(4);
  });

  it('never leaks answer keys, notes or unknown fields', async () => {
    const secret = 'SECRET-ANSWER-KEY';
    const raw = {
      _id: '64b7f0c2a1b2c3d4e5f60718',
      title: 'Leak deck',
      creatorId: OWNER_ID,
      joinCode: '111111',
      status: 'active',
      currentSlideIndex: 0,
      questionStartedAt: new Date(T0),
      questionEndsAt: new Date(T0 + 30_000),
      slides: [
        {
          type: 'type_answer',
          question: 'Q',
          options: [{ text: 'opt', isCorrect: true, explanation: secret }],
          acceptedAnswers: [secret],
          statements: [],
          minLabel: '',
          maxLabel: '',
          scaleMax: 5,
          items: [],
          maxEntries: 3,
          timeLimit: 30,
          points: 100,
          scoreDependsOnTime: true,
          notes: secret,
          internal: secret,
        },
      ],
    };
    models.addRawPresentation(raw);
    const result = await PresentationService.getPresentationByCode('111111');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain('isCorrect');
  });

  it('code lookup 404s while the deck is a draft', async () => {
    models.addPresentation(structuredClone(DECK));
    await expectApiError(
      PresentationService.getPresentationByCode('424242'),
      404,
      'No active presentation deck with that code',
    );
  });
});

// ---------------------------------------------------------------------------
// Accept / validate
// ---------------------------------------------------------------------------

describe('golden: answer acceptance and validation', () => {
  const cases: { slide: number; label: string; body: Record<string, unknown>; message: string }[] = [
    { slide: 0, label: 'select_answer out of range', body: { optionIndex: 3 }, message: 'Invalid option for this slide' },
    { slide: 0, label: 'select_answer without optionIndex', body: { text: 'Paris' }, message: 'Invalid option for this slide' },
    { slide: 1, label: 'type_answer without text', body: { optionIndex: 0 }, message: 'This slide expects a typed answer' },
    { slide: 2, label: 'wordcloud with blank entries', body: { entries: ['   '] }, message: 'Submit at least one word' },
    { slide: 2, label: 'wordcloud with nothing', body: { optionIndex: 1 }, message: 'Submit at least one word' },
    { slide: 3, label: 'open_ended without text', body: { entries: ['x'] }, message: 'This slide expects a typed response' },
    { slide: 4, label: 'scales with too few ratings', body: { ratings: [4] }, message: 'Rate every statement' },
    { slide: 4, label: 'scales out of range', body: { ratings: [6, 1] }, message: 'Ratings must be between 1 and 5' },
    { slide: 4, label: 'scales below range', body: { ratings: [0, 1] }, message: 'Ratings must be between 1 and 5' },
    { slide: 5, label: 'ranking incomplete', body: { ranking: [0, 1] }, message: 'Rank every item' },
    { slide: 5, label: 'ranking with duplicates', body: { ranking: [0, 0, 1] }, message: 'Invalid ranking order' },
    { slide: 5, label: 'ranking out of range', body: { ranking: [0, 1, 3] }, message: 'Invalid ranking order' },
  ];

  for (const c of cases) {
    it(`rejects ${c.label} and lets the participant retry`, async () => {
      const { pid, ada } = await liveDeck();
      await PresentationService.advanceSlide(pid, OWNER_ID, c.slide);
      await expectApiError(answer(pid, ada, c.slide, c.body), 400, c.message);
      expect(redis.members(key(pid, 'answered', c.slide))).toEqual([]);
      expect(redis.hash(key(pid, 'dist', c.slide))).toEqual({});
      expect(redis.events('answer:received')).toEqual([]);
    });
  }

  it('dedupes per participant, rejects bad tokens, stale slides and late answers', async () => {
    const { pid, ada, linus } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);

    await expectApiError(answer(pid, { ...ada, token: 'x'.repeat(48) }, 0, { optionIndex: 0 }), 401, 'Invalid participant token');
    await expectApiError(answer(pid, ada, 1, { text: 'Jupiter' }), 400, 'This slide is no longer accepting answers');

    await answer(pid, ada, 0, { optionIndex: 0 });
    await expectApiError(answer(pid, ada, 0, { optionIndex: 1 }), 409, 'You already responded to this slide');
    expect(redis.hash(key(pid, 'dist', 0))).toEqual({ '0': '1' });

    at(20_000 + 751);
    await expectApiError(answer(pid, linus, 0, { optionIndex: 0 }), 400, "Time's up — response not accepted");
    expect(redis.members(key(pid, 'answered', 0))).toEqual([ada.participantId]);
  });

  // Characterizes a known gap rather than an intended rule: reveal deletes the
  // Redis session key, but the answer path rebuilds it from Mongo while the
  // clock window is still open, so an early manual reveal does not stop answers
  // until `questionEndsAt` + grace. Session-engine work (explicit close) owns
  // changing this; the refactor must not.
  it('an early reveal leaves the window open until the deadline (current behaviour)', async () => {
    const { pid, ada, linus } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 2);
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    at(1_000);
    expect(await answer(pid, ada, 2, { text: 'early' })).toEqual({ accepted: true });
    at(30_000 + 751);
    await expectApiError(answer(pid, linus, 2, { text: 'late' }), 400, "Time's up — response not accepted");
  });

  it('accepts inside the 750ms grace window', async () => {
    const { pid, ada } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    at(20_000 + 750);
    await answer(pid, ada, 0, { optionIndex: 0 });
    expect(JSON.parse(redis.hash(key(pid, 'results', 0))[ada.participantId]!)).toEqual({
      isCorrect: true,
      score: 500,
      scored: true,
    });
  });

  it('rebuilds the answer window from Mongo when the Redis session key is gone', async () => {
    const { pid, ada } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 1);
    for (const k of [...redis.store.keys()]) if (k.endsWith(':session')) redis.store.delete(k);
    at(3_000);
    await answer(pid, ada, 1, { text: 'the jupiter' });
    expect(JSON.parse(redis.hash(key(pid, 'results', 1))[ada.participantId]!)).toEqual({
      isCorrect: true,
      score: 500,
      scored: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('golden: speed scoring', () => {
  const scoreAt = async (elapsedMs: number, slideOverrides: Record<string, unknown>, body = { optionIndex: 0 }) => {
    models.presentations.length = 0;
    const slides = structuredClone(DECK.slides);
    Object.assign(slides[0]!, slideOverrides);
    const { pid, ada } = await liveDeck({ slides });
    at(0);
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    at(elapsedMs);
    await answer(pid, ada, 0, body);
    return JSON.parse(redis.hash(key(pid, 'results', 0))[ada.participantId]!);
  };

  it('scales points from 100% to 50% across the time limit', async () => {
    expect((await scoreAt(0, {})).score).toBe(1000);
    expect((await scoreAt(10_000, {})).score).toBe(750);
    expect((await scoreAt(20_500, {})).score).toBe(500);
    expect((await scoreAt(1_000, { points: 999 })).score).toBe(974);
  });

  it('awards flat points when speed does not matter and zero when wrong', async () => {
    expect(await scoreAt(19_000, { scoreDependsOnTime: false })).toEqual({ isCorrect: true, score: 1000, scored: true });
    expect(await scoreAt(1_000, {}, { optionIndex: 2 })).toEqual({ isCorrect: false, score: 0, scored: true });
    expect(await scoreAt(1_000, { points: 0 })).toEqual({ isCorrect: true, score: 0, scored: true });
  });

  it('participant state exposes the last result only once the window closes', async () => {
    const { pid, ada, linus } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    at(2_000);
    await answer(pid, ada, 0, { optionIndex: 0 });
    await answer(pid, linus, 0, { optionIndex: 2 });

    const during = await PresentationService.getParticipantState(pid, linus.participantId, linus.token);
    expect(during).toEqual({
      participantId: linus.participantId,
      name: 'Linus',
      totalScore: 0,
      correctCount: 0,
      rank: 2,
      lastAnswer: null,
      quizStatus: 'active',
      presentationStatus: 'active',
    });

    at(20_001);
    const after = await PresentationService.getParticipantState(pid, ada.participantId, ada.token);
    expect(after).toEqual({
      participantId: ada.participantId,
      name: 'Ada',
      totalScore: 950,
      correctCount: 1,
      rank: 1,
      lastAnswer: { slideIndex: 0, isCorrect: true, score: 950, scored: true },
      quizStatus: 'active',
      presentationStatus: 'active',
    });

    await PresentationService.advanceSlide(pid, OWNER_ID, 3);
    at(20_001 + 60_001);
    await answer(pid, ada, 3, { text: 'late?' }).catch(() => undefined);
    const unscored = await PresentationService.getParticipantState(pid, linus.participantId, linus.token);
    expect(unscored.lastAnswer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Distribution helper (direct Redis hashes)
// ---------------------------------------------------------------------------

describe('golden: computeSlideDistributionHelper', () => {
  const PID = '64b7f0c2a1b2c3d4e5f60718';
  const seed = async (slideIndex: number, dist: Record<string, string>, disp: Record<string, string> = {}) => {
    if (Object.keys(dist).length) await redis.hSet(key(PID, 'dist', slideIndex), dist);
    if (Object.keys(disp).length) await redis.hSet(key(PID, 'disp', slideIndex), disp);
    await redis.sAdd(key(PID, 'answered', slideIndex), ['a', 'b', 'c']);
    await redis.hSet(key(PID, 'names'), { a: 'A', b: 'B', c: 'C', d: 'D' });
  };

  it('select_answer counts every option, zero-filled', async () => {
    await seed(0, { '2': '3' });
    const result = await computeSlideDistributionHelper(PID, 0, DECK.slides[0]);
    expect(wire(result)).toEqual({
      distribution: {
        kind: 'options',
        counts: [0, 0, 3],
        options: [
          { text: 'Paris', isCorrect: true },
          { text: 'Lyon', isCorrect: false },
          { text: 'Nice', isCorrect: false },
        ],
      },
      answeredCount: 3,
      participantCount: 4,
    });
  });

  it('type_answer keeps the top 20 by count', async () => {
    const dist = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`w${i}`, String(i + 1)]));
    await seed(1, dist);
    const { distribution } = (await computeSlideDistributionHelper(PID, 1, {
      ...DECK.slides[1],
      acceptedAnswers: ['W24 '],
    })) as any;
    expect(distribution.answers).toHaveLength(20);
    expect(distribution.answers[0]).toEqual({ text: 'w24', count: 25, isCorrect: true });
    expect(distribution.answers[19]).toEqual({ text: 'w5', count: 6, isCorrect: false });
    expect(distribution.acceptedAnswers).toEqual(['W24 ']);
  });

  it('wordcloud keeps the top 100 with display casing; open_ended the top 50', async () => {
    const dist = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`w${i}`, String(i + 1)]));
    await seed(2, dist, { w119: 'W119!' });
    const words = ((await computeSlideDistributionHelper(PID, 2, DECK.slides[2])) as any).distribution;
    expect(words.kind).toBe('words');
    expect(words.words).toHaveLength(100);
    expect(words.words[0]).toEqual({ text: 'W119!', count: 120 });
    expect(words.words[1]).toEqual({ text: 'w118', count: 119 });

    await seed(3, dist);
    const responses = ((await computeSlideDistributionHelper(PID, 3, DECK.slides[3])) as any).distribution;
    expect(responses.kind).toBe('responses');
    expect(responses.responses).toHaveLength(50);
    expect(responses.responses[49]).toEqual({ text: 'w70', count: 71 });
  });

  it('scales averages round to two decimals and default labels are empty', async () => {
    await seed(4, { 's0:sum': '10', 's0:count': '3' });
    const { distribution } = await computeSlideDistributionHelper(PID, 4, {
      type: 'scales',
      statements: ['One', 'Two'],
    });
    expect(distribution).toEqual({
      kind: 'scales',
      statements: [
        { statement: 'One', average: 3.33, count: 3 },
        { statement: 'Two', average: 0, count: 0 },
      ],
      scaleMax: 5,
      minLabel: '',
      maxLabel: '',
    });
  });

  it('ranking sorts by Borda points with stable ties', async () => {
    await seed(5, { '0': '4', '1': '9', '2': '4', voters: '3' });
    const { distribution } = await computeSlideDistributionHelper(PID, 5, DECK.slides[5]);
    expect(distribution).toEqual({
      kind: 'ranking',
      items: [
        { text: 'B', points: 9, rank: 1 },
        { text: 'A', points: 4, rank: 2 },
        { text: 'C', points: 4, rank: 3 },
      ],
      voters: 3,
    });
  });

  it('leaderboard has an empty distribution', async () => {
    await seed(6, {});
    const { distribution } = await computeSlideDistributionHelper(PID, 6, DECK.slides[6]);
    expect(distribution).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Host state and session transitions
// ---------------------------------------------------------------------------

describe('golden: host state and transitions', () => {
  it('host state reports participants, answered count, live distribution and standings', async () => {
    const { deck, pid, ada, linus } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    at(1_000);
    await answer(pid, linus, 0, { optionIndex: 0 });

    const state = await PresentationService.getHostState(pid, OWNER_ID);
    expect(state.quiz).toBe(deck);
    expect(state.presentation).toBe(deck);
    expect(state.serverNow).toBe(new Date(T0 + 1_000).toISOString());
    expect(state.answeredCount).toBe(1);
    expect(wire(state.participants)).toEqual([
      { participantId: ada.participantId, name: 'Ada', score: 0 },
      { participantId: linus.participantId, name: 'Linus', score: 975 },
    ]);
    expect(state.liveDistribution).toMatchObject({ kind: 'options', counts: [1, 0, 0] });
    expect(state.leaderboard[0]).toEqual({
      participantId: linus.participantId,
      name: 'Linus',
      score: 975,
      correctCount: 1,
      rank: 1,
    });
  });

  it('enforces forward-only navigation, bounds and ownership', async () => {
    const { pid } = await liveDeck();
    await expectApiError(PresentationService.advanceSlide(pid, OWNER_ID, 7), 400, 'Slide index out of bounds');
    await PresentationService.advanceSlide(pid, OWNER_ID, 2);
    await expectApiError(
      PresentationService.advanceSlide(pid, OWNER_ID, 1),
      400,
      'Cannot navigate backwards during a live session',
    );
    await expectApiError(
      PresentationService.advanceSlide(pid, 'someone-else'),
      403,
      'You do not have permission to manage this presentation',
    );
    expect(await PresentationService.isOwner(pid, OWNER_ID)).toBe(true);
    expect(await PresentationService.isOwner(pid, 'someone-else')).toBe(false);
  });

  it('open-lobby wipes the previous run and rejoins are idempotent per device', async () => {
    const { deck, pid, ada } = await liveDeck();
    await PresentationService.advanceSlide(pid, OWNER_ID, 0);
    await answer(pid, ada, 0, { optionIndex: 0 });

    await PresentationService.openLobby(pid, OWNER_ID);
    expect(deck.status).toBe('lobby');
    expect(deck.currentSlideIndex).toBe(-1);
    expect([...redis.store.keys()].filter((k) => k.startsWith(`presentation:${pid}:`))).toEqual([]);
    expect(models.participants).toEqual([]);
    expect(await PresentationService.isAuthorizedParticipant(pid, ada.participantId, ada.token)).toBe(false);

    const first = await PresentationService.joinPresentation(pid, { name: 'Grace' });
    const again = await PresentationService.joinPresentation(pid, { name: 'Renamed', deviceToken: first.deviceToken });
    expect(again.participantId).toBe(first.participantId);
    expect(again.name).toBe('Grace');
    expect(again.token).toBe(first.token);
    expect(await PresentationService.isAuthorizedParticipant(pid, first.participantId, first.token)).toBe(true);
  });

  it('rejects joins before opening and after ending', async () => {
    const deck = models.addPresentation(structuredClone(DECK));
    const pid = String(deck._id);
    await expectApiError(PresentationService.joinPresentation(pid, { name: 'X' }), 400, 'This presentation is not open yet');
    await PresentationService.openLobby(pid, OWNER_ID);
    await PresentationService.endPresentation(pid, OWNER_ID);
    await expectApiError(
      PresentationService.joinPresentation(pid, { name: 'X' }),
      400,
      'This presentation has already ended',
    );
  });
});

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

describe('golden: slide and answer request schemas', () => {
  const issuesOf = (slide: Record<string, unknown>) => {
    const result = createPresentationSchema.safeParse({ title: 'T', slides: [slide] });
    return result.success ? [] : result.error.issues.map((i) => ({ path: i.path, message: i.message }));
  };

  it('fills legacy defaults for every type', () => {
    const expected = {
      question: 'Q',
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
    };
    const minimal: Record<string, Record<string, unknown>> = {
      select_answer: { options: [{ text: 'a', isCorrect: true }, { text: 'b' }] },
      type_answer: { acceptedAnswers: ['x'] },
      wordcloud: {},
      open_ended: {},
      scales: { statements: ['s'] },
      ranking: { items: ['i', 'j'] },
      leaderboard: {},
    };
    for (const [type, extra] of Object.entries(minimal)) {
      const parsed = createPresentationSchema.parse({ title: 'T', slides: [{ type, question: 'Q', ...extra }] });
      const normalizedExtra = type === 'select_answer'
        ? { options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: false }] }
        : extra;
      expectLegacyShape(parsed.slides[0], { ...expected, type, ...normalizedExtra }, ADDITIVE_SLIDE_KEYS);
    }
  });

  it('keeps the per-type validation messages and paths', () => {
    expect(issuesOf({ type: 'select_answer', question: 'Q', options: [{ text: 'a' }] })).toEqual([
      { path: ['slides', 0, 'options'], message: 'Select-answer slides need at least 2 options' },
      { path: ['slides', 0, 'options'], message: 'Mark at least one option as correct' },
    ]);
    expect(issuesOf({ type: 'type_answer', question: 'Q' })).toEqual([
      { path: ['slides', 0, 'acceptedAnswers'], message: 'Type-answer slides need at least one accepted answer' },
    ]);
    expect(issuesOf({ type: 'scales', question: 'Q' })).toEqual([
      { path: ['slides', 0, 'statements'], message: 'Scales slides need at least one statement' },
    ]);
    expect(issuesOf({ type: 'ranking', question: 'Q', items: ['only'] })).toEqual([
      { path: ['slides', 0, 'items'], message: 'Ranking slides need at least 2 items' },
    ]);
    expect(issuesOf({ type: 'wordcloud', question: '' })).toEqual([
      { path: ['slides', 0, 'question'], message: 'Question text is required' },
    ]);
    for (const type of ['select_answer', 'type_answer', 'wordcloud', 'open_ended', 'scales', 'ranking', 'leaderboard']) {
      const issues = issuesOf({ type, question: 'Q', timeLimit: 4, options: [{ text: 'a', isCorrect: true }, { text: 'b' }], acceptedAnswers: ['a'], statements: ['s'], items: ['i', 'j'] });
      expect(issues).toEqual([{ path: ['slides', 0, 'timeLimit'], message: 'Too small: expected number to be >=5' }]);
    }
    const unknown = issuesOf({ type: 'bogus', question: 'Q' });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.path).toEqual(['slides', 0, 'type']);
    expect(unknown[0]!.message).toContain('Invalid option');
  });

  it('answer schema keeps the legacy fields and the payload-required rule', () => {
    const base = { participantId: 'p', participantToken: 't'.repeat(48), slideIndex: 0 };
    const fail = (body: Record<string, unknown>) => {
      const result = submitPresentationAnswerSchema.safeParse({ ...base, ...body });
      return result.success ? null : result.error.issues.map((i) => ({ path: i.path, message: i.message }));
    };
    expect(fail({})).toEqual([{ path: [], message: 'Provide an answer payload' }]);
    expect(fail({ optionIndex: 8 })?.[0]?.path).toEqual(['optionIndex']);
    expect(fail({ entries: ['a', 'b', 'c', 'd'] })?.[0]?.path).toEqual(['entries']);
    expect(fail({ ratings: [11] })?.[0]?.path).toEqual(['ratings', 0]);
    expect(fail({ ranking: [0] })?.[0]?.path).toEqual(['ranking']);
    expect(submitPresentationAnswerSchema.parse({ ...base, text: '  hi  ' })).toMatchObject({ text: 'hi' });
  });
});
