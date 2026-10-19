import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { redisClient } from '../src/common/config/redis';
import { PLANS } from '../src/common/plans/plans';
import { usageKey, usagePeriod } from '../src/common/plans/usage';
import { ApiError } from '../src/common/utils/ApiError';
import { generateDeckRequestSchema, type DeckOutline, type DeckWarning, type GenerateDeckInput } from '../src/modules/ai/deck/deck.schema';
import {
  assertOutlineKinds,
  Budget,
  DeckService,
  flattenOutline,
  generateSlides,
  MAX_REPAIRS,
  normalizeLlmOutline,
  SLIDE_BATCH_SIZE,
} from '../src/modules/ai/deck/deck.service';
import { DeckLlmTimeoutError, resolveDeckLlm, setDeckLlm, withTimeout } from '../src/modules/ai/deck/llm';
import { buildMockOutline, buildMockSlide } from '../src/modules/ai/deck/mock';
import { availableKinds, DECK_SLIDE_MAPPERS } from '../src/modules/ai/deck/slideMappers';
import { PresentationModel } from '../src/modules/presentations/models/presentation.model';
import { UsageCounterModel } from '../src/modules/workspaces/usageCounter.model';
import { FakeDeckLlm, llmOutline, slidesInPrompt, validGenerated } from './helpers/deckLlm';

const input = (fields: Record<string, unknown> = {}): GenerateDeckInput =>
  generateDeckRequestSchema.parse({ topic: 'Zero trust security', ...fields });

const outlineOf = (kinds: string[], title = 'Deck'): DeckOutline => ({
  title,
  sections: [{ title: 'Part', slides: kinds.map((type, i) => ({ type, intent: `Intent ${i + 1}` })) }],
});

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const error = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
  }
};

/** Answers every slides prompt with a valid slide per requested position. */
const writeAllSlides = (override?: (slide: { position: number; type: string }) => unknown) => (call: { prompt: string }) => ({
  slides: slidesInPrompt(call.prompt).map((slide) => override?.(slide) ?? validGenerated(slide.type, slide.position)),
});

describe('normalizeLlmOutline', () => {
  const allowed = availableKinds();
  const base = { topic: 'Zero trust', slideCount: 4, title: undefined };

  it('keeps known kinds, falls back for unknown ones and cleans text', () => {
    const warnings: DeckWarning[] = [];
    const outline = normalizeLlmOutline(
      {
        title: '  My   deck ',
        sections: [{ title: ' Intro ', slides: [{ type: 'bullets', intent: ' Do  it ' }, { type: 'hologram', intent: 'Unknown kind' }, { type: 'wordcloud', intent: 'Collect words' }, { type: 'quote', intent: 'Say it' }] }],
      },
      base,
      allowed,
      warnings,
    );
    expect(outline.title).toBe('My deck');
    expect(outline.sections[0]!.title).toBe('Intro');
    expect(outline.sections[0]!.slides.map((slide) => slide.type)).toEqual(['bullets', 'bullets', 'wordcloud', 'quote']);
    expect(outline.sections[0]!.slides[0]!.intent).toBe('Do it');
    expect(warnings).toEqual([]);
  });

  it('uses only the categories asked for', () => {
    const onlyPolls = availableKinds({ content: false, polls: true, quiz: false });
    const outline = normalizeLlmOutline(
      { title: 'T', sections: [{ title: 'S', slides: [{ type: 'bullets', intent: 'content slide' }, { type: 'wordcloud', intent: 'poll slide' }] }] },
      { ...base, slideCount: 2 },
      onlyPolls,
      [],
    );
    const types = outline.sections[0]!.slides.map((slide) => slide.type);
    expect(types[1]).toBe('wordcloud');
    expect(types[0]).not.toBe('bullets');
    expect(onlyPolls.map((mapper) => mapper.kind)).toContain(types[0]!);
  });

  it('trims to the requested count and warns', () => {
    const warnings: DeckWarning[] = [];
    const slides = Array.from({ length: 7 }, (_, i) => ({ type: 'bullets', intent: `Slide ${i}` }));
    const outline = normalizeLlmOutline({ title: 'T', sections: [{ title: 'A', slides: slides.slice(0, 3) }, { title: 'B', slides: slides.slice(3) }] }, base, allowed, warnings);
    expect(outline.sections.flatMap((section) => section.slides)).toHaveLength(4);
    expect(warnings.map((warning) => warning.code)).toEqual(['OUTLINE_TRIMMED']);
  });

  it('warns about a short outline and drops empty slides and sections', () => {
    const warnings: DeckWarning[] = [];
    const outline = normalizeLlmOutline(
      { title: '', sections: [{ title: 'Empty', slides: [{ type: 'bullets', intent: '   ' }] }, { title: '', slides: [{ type: 'bullets', intent: 'Real' }] }] },
      base,
      allowed,
      warnings,
    );
    expect(outline.sections).toHaveLength(1);
    expect(outline.sections[0]!.title).toBe('Part 1');
    expect(outline.title).toBe('Zero trust');
    expect(warnings.map((warning) => warning.code)).toEqual(['OUTLINE_SHORT']);
  });

  it('an explicit title wins, and an empty outline is a provider failure', () => {
    const outline = normalizeLlmOutline({ title: 'Model title', sections: [{ title: 'S', slides: [{ type: 'bullets', intent: 'x' }] }] }, { ...base, title: 'Mine' }, allowed, []);
    expect(outline.title).toBe('Mine');
    for (const raw of [{ title: 'T', sections: [] }, { title: 'T' }, null, { title: 'T', sections: 'nope' }] as never[]) {
      expect(() => normalizeLlmOutline(raw, base, allowed, [])).toThrow(ApiError);
    }
  });

  it('caps the number of sections', () => {
    const sections = Array.from({ length: 30 }, (_, i) => ({ title: `S${i}`, slides: [{ type: 'bullets', intent: `i${i}` }] }));
    const outline = normalizeLlmOutline({ title: 'T', sections }, { ...base, slideCount: 30 }, allowed, []);
    expect(outline.sections.length).toBe(12);
  });
});

describe('outline helpers', () => {
  it('flattens with 1-based positions and rejects kinds the server does not offer', () => {
    const outline: DeckOutline = {
      title: 'T',
      sections: [
        { title: 'A', slides: [{ type: 'heading', intent: 'one' }] },
        { title: 'B', slides: [{ type: 'bullets', intent: 'two' }, { type: 'wordcloud', intent: 'three' }] },
      ],
    };
    expect(flattenOutline(outline).map((slide) => [slide.position, slide.section, slide.type])).toEqual([
      [1, 'A', 'heading'],
      [2, 'B', 'bullets'],
      [3, 'B', 'wordcloud'],
    ]);
    expect(() => assertOutlineKinds(outline)).not.toThrow();
    outline.sections[1]!.slides[1]!.type = 'image';
    expect(() => assertOutlineKinds(outline)).toThrow(/outline\.sections\.1\.slides\.1\.type/);
  });
});

describe('generateSlides with an LLM', () => {
  it('writes valid slides in outline order, one call per batch, no repairs', async () => {
    const kinds = DECK_SLIDE_MAPPERS.map((mapper) => mapper.kind);
    const outline = outlineOf([...kinds, ...kinds].slice(0, 20));
    const llm = new FakeDeckLlm({ slides: writeAllSlides() });
    const warnings: DeckWarning[] = [];
    const slides = await generateSlides(llm, input({ slideCount: 20 }), outline, warnings);
    expect(slides).toHaveLength(20);
    expect(warnings).toEqual([]);
    expect(llm.callsFor('slides')).toHaveLength(Math.ceil(20 / SLIDE_BATCH_SIZE));
    expect(llm.callsFor('repair')).toHaveLength(0);
    expect(slides.map((slide) => slide.type)).toEqual(
      [...kinds, ...kinds].slice(0, 20).map((kind) => DECK_SLIDE_MAPPERS.find((mapper) => mapper.kind === kind)!.type),
    );
    expect(slides.every((slide) => slide.notes.length > 0)).toBe(true);
  });

  it('keeps order even when batches finish out of order', async () => {
    const outline = outlineOf(Array.from({ length: 24 }, () => 'bullets'));
    const llm = new FakeDeckLlm({
      slides: async (call) => {
        const slides = slidesInPrompt(call.prompt);
        await new Promise((resolve) => setTimeout(resolve, slides[0]!.position === 1 ? 40 : 1));
        return { slides: slides.map((slide) => ({ ...validGenerated('bullets'), title: `Slide ${slide.position}` })) };
      },
    });
    const slides = await generateSlides(llm, input({ slideCount: 24 }), outline, []);
    expect(slides.map((slide) => (slide.content as { title: string }).title)).toEqual(Array.from({ length: 24 }, (_, i) => `Slide ${i + 1}`));
  });

  it('repairs an invalid slide with one targeted re-prompt', async () => {
    const outline = outlineOf(['bullets', 'multiple_choice_quiz', 'wordcloud']);
    const llm = new FakeDeckLlm({
      // Slide 2 has no correct option: invalid for a graded quiz question.
      slides: writeAllSlides(({ position }) =>
        position === 2
          ? { question: 'Which?', notes: 'n', options: [{ text: 'A', isCorrect: false }, { text: 'B', isCorrect: false }] }
          : undefined,
      ),
      repair: () => ({ slide: validGenerated('multiple_choice_quiz', 2) }),
    });
    const warnings: DeckWarning[] = [];
    const slides = await generateSlides(llm, input({ slideCount: 3 }), outline, warnings);
    expect(slides).toHaveLength(3);
    expect(warnings).toEqual([]);
    expect(llm.callsFor('repair')).toHaveLength(1);
    const repairPrompt = llm.callsFor('repair')[0]!.prompt;
    expect(repairPrompt).toContain('VALIDATION ERRORS TO FIX');
    expect(repairPrompt).toContain('Mark at least one option as correct');
    expect(repairPrompt).toContain('multiple_choice_quiz');
    expect(slides[1]!.question).toBe('Quiz 2?');
    expect(slides[1]!.options?.some((option) => option.isCorrect)).toBe(true);
  });

  it('drops a slide that is still invalid after the repair, with a warning, and never returns it', async () => {
    const outline = outlineOf(['bullets', 'scales', 'bullets']);
    const llm = new FakeDeckLlm({
      slides: writeAllSlides(({ position }) => (position === 2 ? { question: 'Rate', statements: [], notes: 'n' } : undefined)),
      repair: () => ({ slide: { question: 'Still broken', statements: [], notes: 'n' } }),
    });
    const warnings: DeckWarning[] = [];
    const slides = await generateSlides(llm, input({ slideCount: 3 }), outline, warnings);
    expect(slides.map((slide) => slide.type)).toEqual(['bullets', 'bullets']);
    expect(llm.callsFor('repair')).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'SLIDE_DROPPED', position: 2 });
    expect(warnings[0]!.message).toContain('Slide 2');
  });

  it('drops a slide whose repair call fails or times out', async () => {
    const outline = outlineOf(['bullets', 'wordcloud']);
    const llm = new FakeDeckLlm({
      slides: writeAllSlides(({ position }) => (position === 2 ? { notes: 'no question here' } : undefined)),
      repair: () => {
        throw new DeckLlmTimeoutError('repair', 1);
      },
    });
    const warnings: DeckWarning[] = [];
    const slides = await quiet(() => generateSlides(llm, input({ slideCount: 3 }), outline, warnings));
    expect(slides).toHaveLength(1);
    expect(warnings.map((warning) => [warning.code, warning.position])).toEqual([['SLIDE_DROPPED', 2]]);
  });

  it('asks for the notes again when they are missing, and keeps the slide with a warning if they stay missing', async () => {
    const outline = outlineOf(['bullets', 'quote']);
    const withoutNotes = (kind: string) => ({ ...validGenerated(kind), notes: '' });
    const llm = new FakeDeckLlm({
      slides: writeAllSlides(({ position, type }) => (position <= 2 ? withoutNotes(type) : undefined)),
      repair: (_call, index) => ({ slide: index === 0 ? validGenerated('bullets') : withoutNotes('quote') }),
    });
    const warnings: DeckWarning[] = [];
    const slides = await generateSlides(llm, input({ slideCount: 3 }), outline, warnings);
    expect(slides).toHaveLength(2);
    expect(slides[0]!.notes).not.toBe('');
    expect(slides[1]!.notes).toBe('');
    expect(warnings.map((warning) => [warning.code, warning.position])).toEqual([['SLIDE_WITHOUT_NOTES', 2]]);
  });

  it('writes a missing slide from scratch when the batch came back short', async () => {
    const outline = outlineOf(['bullets', 'bullets', 'bullets']);
    const llm = new FakeDeckLlm({
      slides: (call) => ({ slides: slidesInPrompt(call.prompt).slice(0, 2).map((slide) => validGenerated('bullets', slide.position)) }),
      repair: () => ({ slide: validGenerated('bullets', 3) }),
    });
    const warnings: DeckWarning[] = [];
    const slides = await generateSlides(llm, input({ slideCount: 3 }), outline, warnings);
    expect(slides).toHaveLength(3);
    expect(warnings).toEqual([]);
    expect(llm.callsFor('repair')[0]!.prompt).toContain('Write one slide');
  });

  it('ignores extra slides beyond the batch (output size cap)', async () => {
    const outline = outlineOf(['bullets', 'bullets']);
    const llm = new FakeDeckLlm({
      slides: () => ({ slides: Array.from({ length: 50 }, (_, i) => validGenerated('bullets', i + 1)) }),
    });
    const slides = await generateSlides(llm, input({ slideCount: 3 }), outline, []);
    expect(slides).toHaveLength(2);
  });

  it('a failed batch is repaired slide by slide, up to the repair cap; the rest is dropped with warnings', async () => {
    const outline = outlineOf(Array.from({ length: 24 }, () => 'bullets'));
    const llm = new FakeDeckLlm({
      slides: (call) => {
        // The first two batches (16 slides) fail; the third is fine.
        if (slidesInPrompt(call.prompt)[0]!.position <= 9) throw new Error('provider 500');
        return writeAllSlides()(call);
      },
      repair: () => ({ slide: validGenerated('bullets', 1) }),
    });
    const warnings: DeckWarning[] = [];
    const slides = await quiet(() => generateSlides(llm, input({ slideCount: 24 }), outline, warnings));
    expect(llm.callsFor('repair')).toHaveLength(MAX_REPAIRS);
    expect(slides).toHaveLength(8 + MAX_REPAIRS);
    expect(warnings.filter((warning) => warning.code === 'SLIDE_DROPPED')).toHaveLength(16 - MAX_REPAIRS);
    // Warnings are in slide order.
    expect(warnings.map((warning) => warning.position)).toEqual([...warnings.map((warning) => warning.position)].sort((a, b) => a! - b!));
  });

  it('fails with 502 when no batch returns anything, without spending repairs', async () => {
    const llm = new FakeDeckLlm({
      slides: () => {
        throw new Error('provider down');
      },
      repair: () => ({ slide: validGenerated('bullets') }),
    });
    const failure = await quiet(() => generateSlides(llm, input(), outlineOf(['bullets', 'bullets']), [])).catch((error) => error);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_PROVIDER_FAILED' });
    expect(llm.callsFor('repair')).toHaveLength(0);
  });

  it('survives garbage output shapes', async () => {
    const llm = new FakeDeckLlm({
      slides: () => ({ slides: ['text', null, 42, { title: { nested: true } }] }),
      repair: () => 'nonsense',
    });
    const warnings: DeckWarning[] = [];
    const slides = await quiet(() => generateSlides(llm, input({ slideCount: 4 }), outlineOf(['bullets', 'bullets', 'bullets', 'bullets']), warnings));
    expect(slides).toEqual([]);
    expect(warnings).toHaveLength(4);
  });

  it('never stores an oversized or unsafe slide: the registry has the last word', async () => {
    const llm = new FakeDeckLlm({
      slides: () => ({
        slides: [
          {
            title: 'T'.repeat(5000),
            items: Array.from({ length: 50 }, (_, i) => `Item ${i} [x](https://evil.example)`),
            notes: 'n'.repeat(20_000),
          },
        ],
      }),
    });
    const [slide] = await generateSlides(llm, input({ slideCount: 3 }), outlineOf(['bullets']), []);
    const content = slide!.content as { title: string; items: string[] };
    expect(content.title.length).toBeLessThanOrEqual(150);
    expect(content.items.length).toBeLessThanOrEqual(10);
    expect(content.items.join(' ')).not.toContain('evil.example');
    expect(slide!.notes.length).toBeLessThanOrEqual(2000);
  });

  it('batches carry the delimited source text and the same text in each', async () => {
    const llm = new FakeDeckLlm({ slides: writeAllSlides() });
    await generateSlides(llm, input({ slideCount: 10, sourceText: 'Facts about zero trust.' }), outlineOf(Array.from({ length: 10 }, () => 'bullets')), []);
    expect(llm.callsFor('slides')).toHaveLength(2);
    for (const call of llm.callsFor('slides')) expect(call.prompt).toContain('Facts about zero trust.');
  });
});

describe('mock mode', () => {
  it('builds a deterministic outline with the requested size from the enabled categories', () => {
    for (const slideCount of [3, 10, 30]) {
      const outline = buildMockOutline(input({ slideCount }), availableKinds());
      expect(outline.sections.flatMap((section) => section.slides)).toHaveLength(slideCount);
      expect(outline.sections.length).toBeLessThanOrEqual(4);
      expect(JSON.stringify(outline)).toBe(JSON.stringify(buildMockOutline(input({ slideCount }), availableKinds())));
    }
    const quizOnly = buildMockOutline(input({ include: { content: false, polls: false, quiz: true } }), availableKinds({ content: false, polls: false, quiz: true }));
    const quizKinds = new Set(quizOnly.sections.flatMap((section) => section.slides.map((slide) => slide.type)));
    expect([...quizKinds].every((kind) => kind === 'multiple_choice_quiz' || kind === 'type_answer')).toBe(true);
  });

  it('every placeholder slide is valid for every category mix and says it is a placeholder', async () => {
    for (const include of [
      { content: true, polls: true, quiz: true },
      { content: true, polls: false, quiz: false },
      { content: false, polls: true, quiz: false },
      { content: false, polls: false, quiz: true },
    ]) {
      const request = input({ slideCount: 14, include });
      const outline = buildMockOutline(request, availableKinds(request.include));
      const warnings: DeckWarning[] = [];
      const slides = await generateSlides(null, request, outline, warnings);
      expect(slides).toHaveLength(14);
      expect(warnings).toEqual([]);
      expect(slides.every((slide) => /mock mode/i.test(slide.notes))).toBe(true);
    }
  });

  it('covers every kind', () => {
    for (const mapper of DECK_SLIDE_MAPPERS) {
      const slide = buildMockSlide({ position: 1, section: 'S', type: mapper.kind, intent: 'intent' }, 'Topic');
      expect(slide.notes).toBeTruthy();
    }
  });

  it('truncates a long topic instead of overflowing slide fields', async () => {
    const request = input({ topic: 'x'.repeat(200) });
    const outline = buildMockOutline(request, availableKinds());
    const slides = await generateSlides(null, request, outline, []);
    expect(slides).toHaveLength(request.slideCount);
  });
});

describe('timeouts', () => {
  it('withTimeout rejects a call that takes too long and passes through fast ones', async () => {
    await expect(withTimeout(new Promise(() => {}), 10, 'slides')).rejects.toBeInstanceOf(DeckLlmTimeoutError);
    expect(await withTimeout(Promise.resolve(5), 50, 'slides')).toBe(5);
    await expect(withTimeout(Promise.reject(new Error('boom')), 50, 'slides')).rejects.toThrow('boom');
  });

  it('the budget caps a call and refuses to start one near the deadline', () => {
    let now = 1_000;
    const budget = new Budget(() => now);
    expect(budget.callTimeout()).toBe(60_000);
    now += 100_000;
    expect(budget.callTimeout()).toBe(50_000);
    now += 49_000;
    expect(budget.callTimeout()).toBe(0);
  });
});

// ---------- DeckService.generate: usage, workspace, deck creation ----------

const WS_ID = '64b0000000000000000000a1';
const USER_ID = '64b0000000000000000000c3';

const workspace = (fields: Record<string, unknown> = {}) => ({ _id: WS_ID, plan: 'free', planOverrides: null, ...fields });
function requestFor(ws = workspace(), role = 'editor') {
  return {
    user: { id: USER_ID },
    workspace: ws,
    membership: { role, status: 'active', workspaceId: WS_ID },
  } as never;
}

describe('DeckService.generate', () => {
  const counters = new Map<string, number>();
  const mirror = new Map<string, number>();
  const created: { data: Record<string, unknown> }[] = [];
  const deleted: unknown[] = [];
  const saved = {
    incrBy: redisClient.incrBy,
    decrBy: redisClient.decrBy,
    expire: redisClient.expire,
    get: redisClient.get,
    findOne: UsageCounterModel.findOne,
    updateOne: UsageCounterModel.updateOne,
    create: PresentationModel.create,
    deleteOne: PresentationModel.deleteOne,
  };

  beforeEach(() => {
    counters.clear();
    mirror.clear();
    created.length = 0;
    deleted.length = 0;
    (redisClient as any).incrBy = async (key: string, by: number) => counters.set(key, (counters.get(key) ?? 0) + by).get(key)!;
    (redisClient as any).decrBy = async (key: string, by: number) => counters.set(key, (counters.get(key) ?? 0) - by).get(key)!;
    (redisClient as any).expire = async () => 1;
    (redisClient as any).get = async (key: string) => (counters.has(key) ? String(counters.get(key)) : null);
    (UsageCounterModel as any).findOne = () => ({ lean: async () => null });
    (UsageCounterModel as any).updateOne = async () => ({ acknowledged: true });
    (PresentationModel as any).create = async (data: Record<string, unknown>) => {
      const doc = { _id: `deck${created.length + 1}`, ...data };
      created.push({ data });
      return doc;
    };
    (PresentationModel as any).deleteOne = async (filter: unknown) => {
      deleted.push(filter);
      return { acknowledged: true };
    };
  });

  afterEach(() => {
    Object.assign(redisClient as any, { incrBy: saved.incrBy, decrBy: saved.decrBy, expire: saved.expire, get: saved.get });
    Object.assign(UsageCounterModel as any, { findOne: saved.findOne, updateOne: saved.updateOne });
    Object.assign(PresentationModel as any, { create: saved.create, deleteOne: saved.deleteOne });
    setDeckLlm(undefined);
  });

  const usageOf = () => counters.get(usageKey(WS_ID, usagePeriod(), 'ai_deck')) ?? 0;
  const goodLlm = () =>
    new FakeDeckLlm({
      outline: () => llmOutline(['heading', 'bullets', 'multiple_choice_quiz', 'wordcloud'], 'Zero trust 101'),
      slides: writeAllSlides(),
    });

  it('two steps: the outline is returned without creating anything or counting usage', async () => {
    const llm = goodLlm();
    const result = await DeckService.generate(requestFor(), input({ slideCount: 4, step: 'outline' }), { llm });
    expect(result).toMatchObject({ step: 'outline', source: 'llm', outline: { title: 'Zero trust 101' } });
    if (result.step !== 'outline') throw new Error('unreachable');
    expect(result.availableKinds.map((kind) => kind.kind)).toContain('bullets');
    expect(llm.callsFor('slides')).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(usageOf()).toBe(0);
  });

  it('creates a draft deck in the caller\'s workspace, from the reviewed outline, and counts usage once', async () => {
    const llm = goodLlm();
    const reviewed = outlineOf(['heading', 'bullets', 'type_answer'], 'Edited by the author');
    const result = await DeckService.generate(requestFor(), input({ slideCount: 3, outline: reviewed }), { llm });
    if (result.step !== 'deck') throw new Error('expected a deck');
    expect(result.source).toBe('llm');
    expect(result.usage).toMatchObject({ used: 1, limit: PLANS.free.limits.aiDecksPerMonth });
    // The edited outline is used as is: the model is not asked for another one.
    expect(llm.callsFor('outline')).toHaveLength(0);
    expect(created).toHaveLength(1);
    const data = created[0]!.data;
    expect(data).toMatchObject({ title: 'Edited by the author', creatorId: USER_ID, workspaceId: WS_ID });
    expect((data.slides as { type: string; notes: string }[]).map((slide) => slide.type)).toEqual(['heading', 'bullets', 'type_answer']);
    expect((data.slides as { notes: string }[]).every((slide) => slide.notes.length > 0)).toBe(true);
    expect(usageOf()).toBe(1);
  });

  it('runs both steps in one call when no outline is given', async () => {
    const llm = goodLlm();
    const result = await DeckService.generate(requestFor(), input({ slideCount: 4 }), { llm });
    if (result.step !== 'deck') throw new Error('expected a deck');
    expect(llm.callsFor('outline')).toHaveLength(1);
    expect(llm.callsFor('slides')).toHaveLength(1);
    expect(result.outline.title).toBe('Zero trust 101');
    expect(created[0]!.data.title).toBe('Zero trust 101');
    expect(usageOf()).toBe(1);
  });

  it('an explicit title wins over the model\'s', async () => {
    await DeckService.generate(requestFor(), input({ slideCount: 4, title: 'My own title' }), { llm: goodLlm() });
    expect(created[0]!.data.title).toBe('My own title');
  });

  it('counts usage only when the deck was created', async () => {
    const down = new FakeDeckLlm({
      outline: () => llmOutline(['bullets']),
      slides: () => {
        throw new Error('provider down');
      },
    });
    await quiet(() => DeckService.generate(requestFor(), input(), { llm: down })).catch(() => {});
    expect(usageOf()).toBe(0);
    expect(created).toHaveLength(0);

    // Every slide invalid and unrepairable: nothing to create.
    const junk = new FakeDeckLlm({
      outline: () => llmOutline(['bullets', 'bullets', 'bullets']),
      slides: () => ({ slides: [{}, {}, {}] }),
      repair: () => ({ slide: {} }),
    });
    const failure = await quiet(() => DeckService.generate(requestFor(), input({ slideCount: 3 }), { llm: junk })).catch((error) => error);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_DECK_EMPTY' });
    expect(usageOf()).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('an outline call that times out surfaces as a provider failure (after one retry), not a hang', async () => {
    const llm = new FakeDeckLlm({ outline: () => new Promise((_, reject) => setTimeout(() => reject(new DeckLlmTimeoutError('outline', 1)), 5)) });
    const failure = await quiet(() => DeckService.generate(requestFor(), input({ step: 'outline' }), { llm })).catch((error) => error);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_PROVIDER_FAILED' });
    expect(llm.callsFor('outline')).toHaveLength(2);
  });

  it('refuses before calling the model when the plan quota is used up', async () => {
    const quota = PLANS.free.limits.aiDecksPerMonth!;
    counters.set(usageKey(WS_ID, usagePeriod(), 'ai_deck'), quota);
    const llm = goodLlm();
    const failure = await DeckService.generate(requestFor(), input(), { llm }).catch((error) => error);
    expect(failure).toMatchObject({ statusCode: 403, code: 'PLAN_LIMIT_REACHED', details: { limit: 'aiDecksPerMonth', max: quota, used: quota } });
    expect(llm.calls).toHaveLength(0);
    expect(created).toHaveLength(0);
    expect(usageOf()).toBe(quota);
  });

  it('removes the deck when a concurrent run took the last unit', async () => {
    const quota = PLANS.free.limits.aiDecksPerMonth!;
    counters.set(usageKey(WS_ID, usagePeriod(), 'ai_deck'), quota - 1);
    // The slot is free at the pre-check, gone by the time usage is consumed.
    const racing = new FakeDeckLlm({
      outline: () => llmOutline(['heading', 'bullets']),
      slides: (call) => {
        counters.set(usageKey(WS_ID, usagePeriod(), 'ai_deck'), quota);
        return writeAllSlides()(call);
      },
    });
    const failure = await DeckService.generate(requestFor(), input({ slideCount: 3 }), { llm: racing }).catch((error) => error);
    expect(failure).toMatchObject({ statusCode: 403, code: 'PLAN_LIMIT_REACHED' });
    expect(created).toHaveLength(1);
    expect(deleted).toEqual([{ _id: 'deck1' }]);
    expect(usageOf()).toBe(quota);
  });

  it('mock mode labels itself, calls no model and does not count usage', async () => {
    const result = await DeckService.generate(requestFor(), input({ slideCount: 6, sourceText: 'Some notes' }), { llm: null });
    if (result.step !== 'deck') throw new Error('expected a deck');
    expect(result.source).toBe('mock');
    expect(result.usage).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toContain('SOURCE_IGNORED');
    expect((created[0]!.data.slides as unknown[]).length).toBe(6);
    expect(usageOf()).toBe(0);
    const outline = await DeckService.generate(requestFor(), input({ step: 'outline' }), { llm: null });
    expect(outline).toMatchObject({ step: 'outline', source: 'mock' });
  });

  it('mock mode still works when the plan quota is used up (nothing is spent)', async () => {
    counters.set(usageKey(WS_ID, usagePeriod(), 'ai_deck'), PLANS.free.limits.aiDecksPerMonth!);
    const result = await DeckService.generate(requestFor(), input(), { llm: null });
    expect(result.source).toBe('mock');
  });

  it('uses the installed client, and null forces mock mode', async () => {
    setDeckLlm(goodLlm());
    expect((await DeckService.generate(requestFor(), input({ slideCount: 4 }))).source).toBe('llm');
    setDeckLlm(null);
    expect(resolveDeckLlm()).toBeNull();
    expect((await DeckService.generate(requestFor(), input({ slideCount: 4 }))).source).toBe('mock');
  });

  it('is limited by role and needs workspace context', async () => {
    const viewer = await DeckService.generate(requestFor(workspace(), 'viewer'), input(), { llm: null }).catch((error) => error);
    expect(viewer).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    const noWorkspace = await DeckService.generate({ user: { id: USER_ID } } as never, input(), { llm: null }).catch((error) => error);
    expect(noWorkspace).toMatchObject({ statusCode: 500 });
    expect(created).toHaveLength(0);
  });

  it('rejects an edited outline that uses a kind this server does not offer', async () => {
    const failure = await DeckService.generate(requestFor(), input({ outline: outlineOf(['bullets', 'teleport']) }), { llm: null }).catch((error) => error);
    expect(failure).toMatchObject({ statusCode: 400 });
    expect(failure.message).toContain('teleport');
  });

  it('only offers the categories asked for', async () => {
    const llm = new FakeDeckLlm({
      outline: () => llmOutline(['wordcloud', 'bullets', 'multiple_choice_quiz']),
      slides: writeAllSlides(),
    });
    const result = await DeckService.generate(requestFor(), input({ slideCount: 3, include: { content: false, polls: true, quiz: false } }), { llm });
    if (result.step !== 'deck') throw new Error('expected a deck');
    const kinds = result.outline.sections.flatMap((section) => section.slides.map((slide) => slide.type));
    expect(kinds[0]).toBe('wordcloud');
    expect(kinds).not.toContain('bullets');
    expect(kinds).not.toContain('multiple_choice_quiz');
    expect(llm.callsFor('outline')[0]!.prompt).not.toContain('multiple_choice_quiz');
  });
});
