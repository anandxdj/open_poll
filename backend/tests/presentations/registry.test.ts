import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { z } from 'zod';
import { PresentationService } from '../../src/modules/presentations/presentations.service';
import { createPresentationSchema } from '../../src/modules/presentations/presentations.schema';
import { PresentationModel } from '../../src/modules/presentations/presentations.model';
import {
  BUILT_IN_SLIDE_TYPES,
  commonSlideShape,
  defineSlideType,
  getSlideType,
  hincrby,
  listSlideTypes,
  lpushTrim,
  registerSlideType,
  requireSlideType,
} from '../../src/modules/presentations/slides';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, sessionKey, type FakeRedis } from './harness';

const T0 = new Date('2026-03-02T09:00:00.000Z').getTime();
const at = (ms: number) => setSystemTime(new Date(T0 + ms));
const wire = <T>(value: T): any => JSON.parse(JSON.stringify(value));

/** Test-only content type: a note with a title. Never shipped. */
const testNoteSlide = defineSlideType<never, never>({
  type: 'test_note',
  name: 'Test note',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: z.object({
    type: z.literal('test_note'),
    ...commonSlideShape,
    content: z.object({ title: z.string().min(1).max(80), secret: z.string().optional() }),
  }),
  // Allow-list: `content.secret` is deliberately not copied.
  sanitize: (slide) => ({ title: (slide.content as { title: string }).title }),
  label: (slide) => (slide.content as { title: string }).title,
});

/** Test-only response type exercising the `lpush_trim` op and the feed read. */
const testFeedSlide = defineSlideType<{ max: number }, { text?: string }>({
  type: 'test_feed',
  name: 'Test feed',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: z.object({ type: z.literal('test_feed'), ...commonSlideShape }),
  sanitize: (slide) => ({ question: slide.question }),
  acceptConfig: () => ({ max: 2 }),
  answerSchema: z.object({ text: z.string().min(1).max(100) }),
  accept: (cfg, { text }) => ({
    isCorrect: false,
    ops: [hincrby('dist', 'count'), lpushTrim('feed', text!, cfg.max)],
    persist: { optionIndex: null, text: null, payload: { text } },
  }),
  feedLength: 2,
  distribution: (_slide, { dist, feed }) => ({ kind: 'feed', count: Number(dist.count ?? 0), latest: feed }),
  label: (slide) => slide.question,
});

let redis: FakeRedis;
let models: ReturnType<typeof installModelStubs>;
let restoreRedis: () => void;
const disposers: (() => void)[] = [];

beforeEach(() => {
  const fake = installFakeRedis();
  redis = fake.redis;
  restoreRedis = fake.restore;
  models = installModelStubs();
  disposers.push(registerSlideType(testNoteSlide), registerSlideType(testFeedSlide));
  at(0);
});

afterEach(async () => {
  await flush();
  disposers.splice(0).forEach((dispose) => dispose());
  models.restore();
  restoreRedis();
  setSystemTime();
});

const expectApiError = async (promise: Promise<unknown>, statusCode: number, message: string) => {
  let caught: any;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect({ statusCode: caught?.statusCode, message: caught?.message }).toEqual({ statusCode, message });
};

async function liveDeck(slides: Record<string, unknown>[]) {
  const deck = models.addPresentation({ title: 'Mixed', creatorId: OWNER_ID, joinCode: '515151', slides });
  const pid = String(deck._id);
  await PresentationService.openLobby(pid, OWNER_ID);
  const ada = await PresentationService.joinPresentation(pid, { name: 'Ada' });
  return { deck, pid, ada };
}

const SELECT = {
  type: 'select_answer',
  question: 'Pick',
  options: [
    { text: 'A', isCorrect: true },
    { text: 'B', isCorrect: false },
  ],
  timeLimit: 20,
};

describe('slide registry contract', () => {
  it('registers the seven built-in types with their kind, lifecycle and scoring', () => {
    const summary = BUILT_IN_SLIDE_TYPES.map((type) => {
      const def = requireSlideType(type);
      return [type, def.kind, def.lifecycle, def.scored, typeof def.accept, typeof def.distribution];
    });
    expect(summary).toEqual([
      ['select_answer', 'interactive', 'response', true, 'function', 'function'],
      ['type_answer', 'interactive', 'response', true, 'function', 'function'],
      ['wordcloud', 'interactive', 'response', false, 'function', 'function'],
      ['open_ended', 'interactive', 'response', false, 'function', 'function'],
      ['scales', 'interactive', 'response', false, 'function', 'function'],
      ['ranking', 'interactive', 'response', false, 'function', 'function'],
      ['leaderboard', 'system', 'system', false, 'undefined', 'undefined'],
    ]);
    for (const type of BUILT_IN_SLIDE_TYPES) {
      const def = requireSlideType(type);
      expect(Boolean(def.score)).toBe(def.scored);
    }
  });

  it('rejects duplicate keys and disposes fixture types', () => {
    expect(() => registerSlideType(testNoteSlide)).toThrow('already registered');
    const dispose = registerSlideType({ ...testNoteSlide, type: 'test_temp' });
    expect(getSlideType('test_temp')).toBeDefined();
    dispose();
    expect(getSlideType('test_temp')).toBeUndefined();
    expect(listSlideTypes().map((d) => d.type)).toContain('test_note');
  });

  it('throws a 400 for an unregistered stored type', () => {
    expect(() => requireSlideType('nope')).toThrow('Unsupported slide type "nope"');
  });
});

describe('content lifecycle (test fixture type)', () => {
  const NOTE = {
    type: 'test_note',
    question: '',
    notes: 'Speaker only: mention the budget',
    content: { title: 'Welcome', secret: 'host-only' },
    media: { key: 'uploads/k1.png', url: 'https://cdn.example.com/k1.png', alt: 'Logo', layout: 'left' },
    timeLimit: 0,
  };

  it('publishes slide:shown with the sanitized slide and opens no answer window', async () => {
    const { deck, pid, ada } = await liveDeck([NOTE, SELECT]);
    expect(deck.slides[0].kind).toBe('content');

    await PresentationService.advanceSlide(pid, OWNER_ID);
    const shown = redis.lastEvent('slide:shown')!;
    expect(shown.audience).toBe('all');
    expect(shown.payload).toEqual({
      slideId: String(deck.slides[0]._id),
      slideIndex: 0,
      isLastSlide: false,
      serverNow: new Date(T0).toISOString(),
      slide: {
        slideIndex: 0,
        totalSlides: 2,
        type: 'test_note',
        kind: 'content',
        scored: false,
        title: 'Welcome',
        media: { url: 'https://cdn.example.com/k1.png', alt: 'Logo', layout: 'left' },
        layout: null,
      },
    });
    expect(JSON.stringify(redis.published)).not.toContain('Speaker only');
    expect(JSON.stringify(redis.published)).not.toContain('host-only');
    expect(redis.events('question:started')).toEqual([]);
    expect(deck.questionStartedAt).toBeNull();
    expect(deck.questionEndsAt).toBeNull();
    const sid = String(models.liveSession(pid)._id);
    expect(await redis.hGet(sessionKey(sid, 'slides'), String(deck.slides[0]._id))).toBeNull();

    await expectApiError(
      PresentationService.submitAnswer(pid, {
        participantId: ada.participantId,
        participantToken: ada.token,
        slideIndex: 0,
        payload: { anything: true },
      }),
      400,
      'This slide is no longer accepting answers'
    );
    await expectApiError(
      PresentationService.revealCurrentSlide(pid, OWNER_ID),
      400,
      'Test note slides have nothing to reveal'
    );

    const lookup = wire(await PresentationService.getPresentationByCode('515151'));
    expect(lookup.currentSlide).toEqual(shown.payload.slide);
    expect(lookup.questionStartedAt).toBeUndefined();
    expect(lookup.questionEndsAt).toBeUndefined();

    const host = await PresentationService.getHostState(pid, OWNER_ID);
    expect(host.liveDistribution).toBeNull();

    // The next response slide runs as before.
    at(5_000);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:started')!.payload.slide).toMatchObject({ slideIndex: 1, type: 'select_answer' });
    await PresentationService.submitAnswer(pid, {
      participantId: ada.participantId,
      participantToken: ada.token,
      slideIndex: 1,
      optionIndex: 0,
    });
    expect(redis.hash(sessionKey(sid, 'dist', String(deck.slides[1]._id)))).toEqual({ '0': '1' });
  });

  it('code lookup returns the current slide for system slides too', async () => {
    const { pid } = await liveDeck([SELECT, { type: 'leaderboard', question: 'Standings' }]);
    await PresentationService.advanceSlide(pid, OWNER_ID, 1);
    const lookup = wire(await PresentationService.getPresentationByCode('515151'));
    expect(lookup.currentSlide).toMatchObject({ slideIndex: 1, type: 'leaderboard', kind: 'system', scored: false });
    expect(lookup.questionEndsAt).toBeUndefined();
  });

  it('validates registered types in requests and forgets them once disposed', () => {
    const parse = (slide: Record<string, unknown>) => createPresentationSchema.safeParse({ title: 'T', slides: [slide] });
    const ok = parse(NOTE);
    expect(ok.success).toBe(true);
    expect(ok.data!.slides[0]).toEqual({
      type: 'test_note',
      question: '',
      notes: 'Speaker only: mention the budget',
      media: { key: 'uploads/k1.png', url: 'https://cdn.example.com/k1.png', alt: 'Logo', layout: 'left' },
      layout: null,
      timeLimit: 0,
      content: { title: 'Welcome', secret: 'host-only' },
    });

    const bad = parse({ ...NOTE, content: { title: '' } });
    expect(bad.error!.issues.map((i) => i.path)).toEqual([['slides', 0, 'content', 'title']]);
    const badMedia = parse({ ...NOTE, media: { url: 'javascript:alert(1)' } });
    expect(badMedia.error!.issues.map((i) => [i.path, i.message])).toEqual([
      [['slides', 0, 'media', 'url'], 'Media URL must be an http(s) URL'],
    ]);
    const longNotes = parse({ ...SELECT, notes: 'x'.repeat(5001) });
    expect(longNotes.error!.issues.map((i) => i.path)).toEqual([['slides', 0, 'notes']]);

    disposers.splice(0).forEach((dispose) => dispose());
    const gone = parse(NOTE);
    expect(gone.error!.issues[0]!.path).toEqual(['slides', 0, 'type']);
  });
});

describe('slide subdocument fields', () => {
  it('derives kind from the registry and defaults the additive fields', async () => {
    const deck = new PresentationModel({
      title: 'Fields',
      creatorId: OWNER_ID,
      joinCode: '000001',
      slides: [SELECT, { type: 'leaderboard' }, { type: 'test_note', content: { title: 'Hi' }, timeLimit: 0 }],
    });
    expect(deck.slides.map((s) => s.kind)).toEqual(['interactive', 'system', 'content']);
    const first = wire(deck.slides[0]);
    expect(first).toMatchObject({ notes: '', media: null, layout: null, content: null, config: null });
    expect(deck.slides[1]!.question).toBe('');
    expect(deck.validateSync()).toBeUndefined();

    // kind follows type on validate; unknown types and over-long notes are rejected.
    deck.slides[1]!.type = 'test_note';
    await deck.validate();
    expect(deck.slides[1]!.kind).toBe('content');
    deck.slides[0]!.type = 'bogus';
    deck.slides[2]!.notes = 'x'.repeat(5001);
    const errors = Object.keys(deck.validateSync()?.errors ?? {}).sort();
    expect(errors).toEqual(['slides.0.type', 'slides.2.notes']);
  });
});

describe('generic answer payload', () => {
  it('grades `payload` through the type answerSchema and persists like the legacy fields', async () => {
    const { pid, ada } = await liveDeck([SELECT]);
    await PresentationService.advanceSlide(pid, OWNER_ID);
    at(2_000);
    await expectApiError(
      PresentationService.submitAnswer(pid, {
        participantId: ada.participantId,
        participantToken: ada.token,
        slideIndex: 0,
        payload: { optionIndex: 'zero' },
      }),
      400,
      'payload.optionIndex: Invalid input: expected number, received string'
    );
    // The rejected attempt released the dedup marker; payload wins over legacy fields.
    await PresentationService.submitAnswer(pid, {
      participantId: ada.participantId,
      participantToken: ada.token,
      slideIndex: 0,
      optionIndex: 1,
      payload: { optionIndex: 0 },
    });
    await flush();
    expect(models.answers[0]).toMatchObject({ optionIndex: 0, text: null, payload: null, isCorrect: true, score: 950 });
  });
});

describe('lpush_trim ops and the feed', () => {
  it('keeps the newest entries and hands them to distribution', async () => {
    const { deck, pid, ada } = await liveDeck([{ type: 'test_feed', question: 'Say something', timeLimit: 30 }]);
    const bob = await PresentationService.joinPresentation(pid, { name: 'Bob' });
    const cy = await PresentationService.joinPresentation(pid, { name: 'Cy' });
    await PresentationService.advanceSlide(pid, OWNER_ID);
    for (const [who, text] of [
      [ada, 'first'],
      [bob, 'second'],
      [cy, 'third'],
    ] as const) {
      await PresentationService.submitAnswer(pid, {
        participantId: who.participantId,
        participantToken: who.token,
        slideIndex: 0,
        payload: { text },
      });
    }
    const sid = String(models.liveSession(pid)._id);
    expect(await redis.lRange(sessionKey(sid, 'feed', String(deck.slides[0]._id)), 0, -1)).toEqual(['third', 'second']);
    await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    expect(redis.lastEvent('question:revealed')!.payload.distribution).toEqual({
      kind: 'feed',
      count: 3,
      latest: ['third', 'second'],
    });
  });
});

describe('export columns and cells', () => {
  const slide = (data: Record<string, unknown>) =>
    new PresentationModel({ title: 't', creatorId: 'c', joinCode: '1', slides: [data] }).slides[0]!;

  it('renders each built-in answer as cells under its columns', () => {
    const select = slide(SELECT);
    const def = requireSlideType('select_answer');
    expect(def.exportColumns!(select)).toEqual(['Pick']);
    expect(def.exportCells!(select, { optionIndex: 1, isCorrect: false, score: 0 })).toEqual(['B']);
    expect(def.exportCells!(select, null)).toEqual([null]);

    const scales = slide({ type: 'scales', question: 'Rate', statements: ['Pace', 'Depth'] });
    const scalesDef = requireSlideType('scales');
    expect(scalesDef.exportColumns!(scales)).toEqual(['Rate — Pace', 'Rate — Depth']);
    expect(scalesDef.exportCells!(scales, { payload: { ratings: [4] }, isCorrect: false, score: 0 })).toEqual([4, null]);

    const ranking = slide({ type: 'ranking', question: 'Order', items: ['X', 'Y', 'Z'] });
    expect(
      requireSlideType('ranking').exportCells!(ranking, { payload: { ranking: [2, 0, 1] }, isCorrect: false, score: 0 })
    ).toEqual(['Z > X > Y']);

    const cloud = slide({ type: 'wordcloud', question: 'Words' });
    expect(
      requireSlideType('wordcloud').exportCells!(cloud, { payload: { entries: ['a', 'b'] }, isCorrect: false, score: 0 })
    ).toEqual(['a, b']);
    expect(requireSlideType('type_answer').exportCells!(cloud, { text: 'hi', isCorrect: true, score: 1 })).toEqual(['hi']);
    expect(requireSlideType('open_ended').label(slide({ type: 'open_ended', question: '  ' }))).toBe('Open ended');
    expect(requireSlideType('leaderboard').exportColumns).toBeUndefined();
  });
});

