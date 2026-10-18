import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import {
  DisabledStorage,
  setStorageDriver,
  type StorageDriver,
} from '../../src/common/storage/storage';
import { MediaAssetModel } from '../../src/modules/uploads/media.model';
import { PresentationService } from '../../src/modules/presentations/presentations.service';
import { createPresentationSchema } from '../../src/modules/presentations/presentations.schema';
import { requireSlideType, toParticipantSlide } from '../../src/modules/presentations/slides';
import { assertContentMediaInWorkspace } from '../../src/modules/presentations/slides/types/content/media';
import { flush, installFakeRedis, installModelStubs, OWNER_ID, type FakeRedis } from './harness';

/**
 * The eight content slide types (W1-D): request schemas (accept / reject,
 * including script-ish input), the participant allow-list, labels, media
 * keys vs storage, and the `content` lifecycle on a content-only deck.
 */

const CONTENT_TYPES = [
  'big_number',
  'bullets',
  'heading',
  'image',
  'instructions',
  'paragraph',
  'quote',
  'video',
] as const;

const CDN = 'https://cdn.example/media';
const IMAGE_KEY = 'uploads/64b0000000000000000000a1/slide_image/202610/7d6c1f9e-4f0b-4d6c-9a43-3f4f1f0c2b11.png';
const VIDEO_KEY = 'uploads/64b0000000000000000000a1/slide_video/202610/0b7e3a52-1d7e-4bd2-9f0a-5b8c2f6d9e10.mp4';

/** A configured bucket whose objects are served from `CDN`. */
const enabledStorage = (): StorageDriver => ({
  enabled: true,
  presignPut: async () => {
    throw new Error('unused');
  },
  publicUrl: (key) => `${CDN}/${key}`,
  stat: async () => null,
  getObject: async () => {
    throw new Error('unused');
  },
  putObject: async () => {},
  delete: async () => {},
});

const withStorage = <T>(driver: StorageDriver, run: () => T): T => {
  const previous = setStorageDriver(driver);
  try {
    return run();
  } finally {
    setStorageDriver(previous);
  }
};

const parse = (slide: Record<string, unknown>) => createPresentationSchema.safeParse({ title: 'T', slides: [slide] });

const parsed = (slide: Record<string, unknown>) => {
  const result = parse(slide);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data.slides[0]!;
};

/** `[path, message]` of every issue, path relative to the slide. */
const issues = (slide: Record<string, unknown>) => {
  const result = parse(slide);
  expect(result.success).toBe(false);
  return result.error!.issues.map((issue) => [issue.path.slice(2).join('.'), issue.message]);
};

/** The `content` participants receive for a stored slide. */
const shownContent = (slide: unknown) =>
  (toParticipantSlide(slide as any, 0, 1) as Record<string, unknown>).content;

const SCRIPT = '<script>alert(1)</script>';

/** One valid slide of every content type (pasted image URL, YouTube video). */
const VALID: Record<(typeof CONTENT_TYPES)[number], Record<string, unknown>> = {
  heading: { type: 'heading', content: { title: 'Welcome', subtitle: 'Kick-off' } },
  paragraph: {
    type: 'paragraph',
    content: { title: 'Why', body: 'We **ship** _weekly_. See [the plan](https://example.com/plan).' },
  },
  bullets: { type: 'bullets', content: { title: 'Agenda', items: ['Intro', 'Demo', 'Q&A'] } },
  image: {
    type: 'image',
    content: { url: 'https://images.example.com/team.jpg', alt: 'The team on stage', fit: 'cover', caption: 'Berlin' },
  },
  big_number: { type: 'big_number', content: { value: 87.5, label: 'of teams ship weekly', prefix: '', suffix: '%' } },
  quote: { type: 'quote', content: { text: 'Simplicity is prerequisite for reliability.', attribution: 'Dijkstra' } },
  video: { type: 'video', content: { provider: 'youtube', id: 'dQw4w9WgXcQ', start: 42 } },
  instructions: { type: 'instructions', content: { showQr: true, showCode: false, text: 'Grab your phone' } },
};

describe('content slide registry entries', () => {
  it('registers all eight types as unscored content slides without an answer path', () => {
    for (const type of CONTENT_TYPES) {
      const def = requireSlideType(type);
      expect([def.kind, def.lifecycle, def.scored]).toEqual(['content', 'content', false]);
      expect(def.accept).toBeUndefined();
      expect(def.answerSchema).toBeUndefined();
      expect(def.distribution).toBeUndefined();
      expect(def.score).toBeUndefined();
    }
  });
});

describe('content slide request schemas', () => {
  it('accepts each type, stores timeLimit 0 whatever was sent, and defaults the common fields', () => {
    for (const type of CONTENT_TYPES) {
      const slide = parsed({ ...VALID[type], timeLimit: 30 });
      expect(slide).toMatchObject({ type, question: '', notes: '', media: null, layout: null, timeLimit: 0 });
      expect(slide.content).toBeDefined();
    }
  });

  it('fills defaults and drops unknown content keys', () => {
    expect(parsed({ type: 'heading', content: { title: '  Hi  ', secret: 'x' } }).content).toEqual({
      title: 'Hi',
      subtitle: '',
    });
    expect(parsed({ type: 'paragraph', content: { body: 'Text' } }).content).toEqual({ title: '', body: 'Text' });
    expect(parsed({ type: 'bullets', content: { items: [' a '] } }).content).toEqual({ title: '', items: ['a'] });
    expect(parsed({ type: 'image', content: { url: 'https://x.example/a.png', alt: 'A' } }).content).toEqual({
      key: null,
      url: 'https://x.example/a.png',
      alt: 'A',
      fit: 'contain',
      caption: '',
    });
    expect(parsed({ type: 'big_number', content: { value: -3 } }).content).toEqual({
      value: -3,
      label: '',
      prefix: '',
      suffix: '',
    });
    expect(parsed({ type: 'quote', content: { text: 'Q' } }).content).toEqual({ text: 'Q', attribution: '' });
    expect(parsed({ type: 'video', content: { provider: 'vimeo', id: '76979871', key: IMAGE_KEY } }).content).toEqual({
      provider: 'vimeo',
      id: '76979871',
      key: null,
      url: null,
      start: 0,
    });
    expect(parsed({ type: 'instructions', content: {} }).content).toEqual({ showQr: true, showCode: true, text: '' });
  });

  it('stores markup in text fields verbatim (it is rendered as text, never as HTML)', () => {
    expect(parsed({ type: 'heading', content: { title: SCRIPT, subtitle: '<img src=x onerror=alert(1)>' } }).content).toEqual({
      title: SCRIPT,
      subtitle: '<img src=x onerror=alert(1)>',
    });
    expect(parsed({ type: 'paragraph', content: { body: `<b>hi</b> ${SCRIPT}` } }).content).toMatchObject({
      body: `<b>hi</b> ${SCRIPT}`,
    });
  });

  it('rejects missing or oversized text', () => {
    expect(issues({ type: 'heading', content: { title: '   ' } })).toEqual([
      ['content.title', 'Heading title is required'],
    ]);
    expect(issues({ type: 'heading' })[0]![0]).toBe('content');
    expect(issues({ type: 'paragraph', content: { body: 'x'.repeat(2001) } })[0]![0]).toBe('content.body');
    expect(issues({ type: 'quote', content: { text: '' } })).toEqual([['content.text', 'Quote text is required']]);
    expect(issues({ type: 'instructions', content: { text: 'x'.repeat(301) } })[0]![0]).toBe('content.text');
  });

  it('only links paragraphs to http(s) and mailto targets', () => {
    expect(parsed({ type: 'paragraph', content: { body: 'Mail [us](mailto:hi@example.com) or [web](http://a.example)' } }))
      .toBeDefined();
    // Balanced parentheses belong to the target (same pattern as the renderer).
    expect(parsed({ type: 'paragraph', content: { body: '[Foo](https://en.wikipedia.org/wiki/Foo_(bar))' } }))
      .toBeDefined();
    for (const target of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '/relative']) {
      expect(issues({ type: 'paragraph', content: { body: `Click [here](${target})` } })).toEqual([
        ['content.body', 'Links must start with https://, http:// or mailto:'],
      ]);
    }
  });

  it('bounds bullet lists to 1–10 non-empty items', () => {
    expect(issues({ type: 'bullets', content: { items: [] } })).toEqual([['content.items', 'Add at least one bullet']]);
    expect(issues({ type: 'bullets', content: { items: ['a', ' '] } })).toEqual([
      ['content.items.1', 'Bullet text is required'],
    ]);
    expect(issues({ type: 'bullets', content: { items: Array.from({ length: 11 }, (_, i) => `#${i}`) } })).toEqual([
      ['content.items', 'Bullet lists hold up to 10 items'],
    ]);
  });

  it('requires image alt text and https image URLs', () => {
    expect(issues({ type: 'image', content: { url: 'https://x.example/a.png' } })[0]![0]).toBe('content.alt');
    expect(issues({ type: 'image', content: { url: 'https://x.example/a.png', alt: ' ' } })).toEqual([
      ['content.alt', 'Alt text is required: describe the image for people who cannot see it'],
    ]);
    for (const url of [
      'http://x.example/a.png',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      '//x.example/a.png',
      'https://user:pass@x.example/a.png',
      'not a url',
    ]) {
      expect(issues({ type: 'image', content: { url, alt: 'A' } })).toEqual([
        ['content.url', 'Image URL must start with https://'],
      ]);
    }
    expect(issues({ type: 'image', content: { url: 'https://x.example/a.png', alt: 'A', fit: 'stretch' } })[0]![0]).toBe(
      'content.fit'
    );
  });

  it('keeps an image or video without a source as a placeholder', () => {
    expect(parsed({ type: 'image', content: { alt: 'Diagram to add' } }).content).toMatchObject({ key: null, url: null });
    expect(parsed({ type: 'video', content: { provider: 'youtube', id: '' } }).content).toMatchObject({ id: null });
  });

  it('accepts numbers only for big_number', () => {
    for (const value of ['87', null, Number.POSITIVE_INFINITY, 1e16]) {
      expect(issues({ type: 'big_number', content: { value } })[0]![0]).toBe('content.value');
    }
    expect(issues({ type: 'big_number', content: {} })).toEqual([['content.value', 'Enter the number to show']]);
  });

  it('validates YouTube and Vimeo ids strictly', () => {
    for (const id of ['dQw4w9WgXcQ', 'a-b_c-d_e-f']) {
      expect(parsed({ type: 'video', content: { provider: 'youtube', id } }).content).toMatchObject({ id });
    }
    for (const id of [
      'dQw4w9WgXc',
      'dQw4w9WgXcQQ',
      'https://youtu.be/dQw4w9WgXcQ',
      '"><script>x',
      'dQw4w9WgX?Q',
      '../../x/abc',
    ]) {
      expect(issues({ type: 'video', content: { provider: 'youtube', id } })).toEqual([
        ['content.id', 'Not a YouTube video id (11 letters, digits, - or _)'],
      ]);
    }
    for (const id of ['76979871', '123456']) {
      expect(parsed({ type: 'video', content: { provider: 'vimeo', id } }).content).toMatchObject({ id });
    }
    for (const id of ['12345', '0123456', 'abc123456', '76979871?autoplay=1', 'https://vimeo.com/76979871']) {
      expect(issues({ type: 'video', content: { provider: 'vimeo', id } })).toEqual([
        ['content.id', 'Not a Vimeo video id (digits only)'],
      ]);
    }
    expect(issues({ type: 'video', content: { provider: 'dailymotion', id: 'x' } })[0]![0]).toBe('content.provider');
    expect(issues({ type: 'video', content: { provider: 'youtube', id: 'dQw4w9WgXcQ', start: -1 } })[0]![0]).toBe(
      'content.start'
    );
  });
});

describe('uploaded media keys', () => {
  it('are refused while storage is off', () => {
    withStorage(new DisabledStorage(), () => {
      expect(issues({ type: 'image', content: { key: IMAGE_KEY, alt: 'A' } })).toEqual([
        ['content.key', 'File uploads are not configured on this server; use a link instead'],
      ]);
      expect(issues({ type: 'video', content: { provider: 'file', key: VIDEO_KEY } })).toEqual([
        ['content.key', 'File uploads are not configured on this server; use a link instead'],
      ]);
    });
  });

  it('pin the URL to the storage object when storage is on', () => {
    withStorage(enabledStorage(), () => {
      const image = parsed({
        type: 'image',
        content: { key: IMAGE_KEY, url: 'https://evil.example/other.png', alt: 'Logo' },
      });
      expect(image.content).toMatchObject({ key: IMAGE_KEY, url: `${CDN}/${IMAGE_KEY}` });

      const video = parsed({ type: 'video', content: { provider: 'file', key: VIDEO_KEY, id: 'dQw4w9WgXcQ', start: 5 } });
      expect(video.content).toEqual({ provider: 'file', id: null, key: VIDEO_KEY, url: `${CDN}/${VIDEO_KEY}`, start: 5 });
    });
  });

  it('must look like an upload of the right kind', () => {
    withStorage(enabledStorage(), () => {
      for (const key of ['../secrets.png', '/abs/a.png', 'uploads/a//b.png', 'uploads/x/logo.svg', 'uploads/x/noext']) {
        expect(issues({ type: 'image', content: { key, alt: 'A' } })).toEqual([['content.key', 'Not an uploaded image']]);
      }
      expect(issues({ type: 'video', content: { provider: 'file', key: IMAGE_KEY } })).toEqual([
        ['content.key', 'Not an uploaded video'],
      ]);
    });
  });

  describe('assertContentMediaInWorkspace', () => {
    const WS = '64b0000000000000000000a1';
    const saved = MediaAssetModel.find;
    let queries: any[];
    let assets: { key: string; mime: string; workspaceId: string }[];

    beforeEach(() => {
      queries = [];
      assets = [];
      (MediaAssetModel as any).find = (filter: any) => {
        queries.push(filter);
        const found = assets.filter((a) => a.workspaceId === filter.workspaceId && filter.key.$in.includes(a.key));
        return { select: () => ({ lean: async () => found }) };
      };
    });
    afterEach(() => {
      (MediaAssetModel as any).find = saved;
    });

    const deck = [
      { type: 'heading', content: { title: 'Hi' } },
      { type: 'image', content: { key: IMAGE_KEY, url: `${CDN}/${IMAGE_KEY}`, alt: 'A' } },
      { type: 'video', content: { provider: 'file', key: VIDEO_KEY } },
      { type: 'image', content: { key: null, url: 'https://x.example/a.png', alt: 'B' } },
    ];

    const rejection = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        return error as any;
      }
      throw new Error('expected a rejection');
    };

    it('passes when every key is a MediaAsset of the workspace, in one query', async () => {
      assets.push(
        { key: IMAGE_KEY, mime: 'image/png', workspaceId: WS },
        { key: VIDEO_KEY, mime: 'video/mp4', workspaceId: WS }
      );
      await withStorage(enabledStorage(), () => assertContentMediaInWorkspace(deck, WS));
      expect(queries).toEqual([{ workspaceId: WS, key: { $in: [IMAGE_KEY, VIDEO_KEY] } }]);
    });

    it("rejects another workspace's upload and uploads of the wrong kind", async () => {
      assets.push(
        { key: IMAGE_KEY, mime: 'image/png', workspaceId: '64b0000000000000000000ff' },
        { key: VIDEO_KEY, mime: 'video/mp4', workspaceId: WS }
      );
      const error = await rejection(withStorage(enabledStorage(), () => assertContentMediaInWorkspace(deck, WS)));
      expect({ status: error.statusCode, code: error.code, message: error.message }).toEqual({
        status: 400,
        code: 'MEDIA_NOT_FOUND',
        message: 'Slide 2: the uploaded image was not found in this workspace',
      });

      assets.splice(0, assets.length, { key: IMAGE_KEY, mime: 'video/mp4', workspaceId: WS });
      const wrongKind = await rejection(
        withStorage(enabledStorage(), () => assertContentMediaInWorkspace([deck[1]!], WS))
      );
      expect(wrongKind.code).toBe('MEDIA_NOT_FOUND');
    });

    it('skips the query when no slide references an upload, and refuses keys without storage', async () => {
      await withStorage(new DisabledStorage(), () => assertContentMediaInWorkspace([deck[0]!, deck[3]!], WS));
      expect(queries).toEqual([]);
      const error = await rejection(withStorage(new DisabledStorage(), () => assertContentMediaInWorkspace(deck, WS)));
      expect([error.statusCode, error.code]).toEqual([400, 'STORAGE_DISABLED']);
    });
  });
});

describe('participant payloads (allow-list)', () => {
  const stored = (slide: Record<string, unknown>, content: Record<string, unknown>) => ({
    ...parsed(slide),
    _id: undefined,
    kind: 'content',
    notes: 'SPEAKER ONLY',
    content: { ...(parsed(slide).content as object), ...content },
  });

  it('copies only the content fields of each type', () => {
    const payloads = CONTENT_TYPES.map((type) => {
      const slide = stored(VALID[type], { secret: 'host-only', key: 'uploads/ws/slide_image/1/x.png' });
      return toParticipantSlide(slide as any, 0, 1) as Record<string, unknown>;
    });
    const text = JSON.stringify(payloads);
    expect(text).not.toContain('SPEAKER ONLY');
    expect(text).not.toContain('host-only');
    expect(text).not.toContain('uploads/ws');
    expect(text).not.toContain('"key"');

    const contentOf = (type: (typeof CONTENT_TYPES)[number]) =>
      payloads[CONTENT_TYPES.indexOf(type)]!.content as Record<string, unknown>;
    expect(payloads[0]).toMatchObject({ type: 'big_number', kind: 'content', scored: false, slideIndex: 0 });
    expect(contentOf('heading')).toEqual({ title: 'Welcome', subtitle: 'Kick-off' });
    expect(contentOf('paragraph')).toEqual({
      title: 'Why',
      body: 'We **ship** _weekly_. See [the plan](https://example.com/plan).',
    });
    expect(contentOf('bullets')).toEqual({ title: 'Agenda', items: ['Intro', 'Demo', 'Q&A'] });
    expect(contentOf('big_number')).toEqual({ value: 87.5, label: 'of teams ship weekly', prefix: '', suffix: '%' });
    expect(contentOf('quote')).toEqual({ text: 'Simplicity is prerequisite for reliability.', attribution: 'Dijkstra' });
    expect(contentOf('video')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ', url: null, start: 42 });
    expect(contentOf('instructions')).toEqual({ showQr: true, showCode: false, text: 'Grab your phone' });
  });

  it('serves uploads from the storage URL and never exposes the key', () => {
    withStorage(enabledStorage(), () => {
      const image = parsed({ type: 'image', content: { key: IMAGE_KEY, alt: 'Logo', caption: 'Ours' } });
      expect(shownContent(image)).toEqual({
        url: `${CDN}/${IMAGE_KEY}`,
        alt: 'Logo',
        fit: 'contain',
        caption: 'Ours',
      });
      const video = parsed({ type: 'video', content: { provider: 'file', key: VIDEO_KEY } });
      expect(shownContent(video)).toEqual({
        provider: 'file',
        id: null,
        url: `${CDN}/${VIDEO_KEY}`,
        start: 0,
      });
    });
  });

  it('re-checks stored video ids and coerces malformed stored values', () => {
    const slide = (content: unknown) => ({ type: 'video', question: '', notes: '', media: null, layout: null, content });
    expect(shownContent(slide({ provider: 'youtube', id: '"><script>' }))).toEqual({
      provider: 'youtube',
      id: null,
      url: null,
      start: 0,
    });
    expect(shownContent(slide({ provider: 'evil', start: 1e9 }))).toMatchObject({
      provider: 'youtube',
      start: 86_400,
    });
    expect(shownContent({ ...slide(null), type: 'heading' })).toEqual({
      title: '',
      subtitle: '',
    });
    expect(shownContent({ ...slide({ items: 'nope' }), type: 'bullets' })).toEqual({
      title: '',
      items: [],
    });
  });

  it('labels slides from their content', () => {
    const labels = CONTENT_TYPES.map((type) => requireSlideType(type).label(parsed(VALID[type]) as any));
    expect(labels).toEqual([
      '87.5% of teams ship weekly',
      'Agenda',
      'Welcome',
      'Berlin',
      'Grab your phone',
      'Why',
      'Simplicity is prerequisite for reliability.',
      'YouTube video',
    ]);
    expect(requireSlideType('paragraph').label(parsed({ type: 'paragraph', content: { body: 'x'.repeat(100) } }) as any))
      .toBe(`${'x'.repeat(79)}…`);
    expect(requireSlideType('instructions').label(parsed({ type: 'instructions', content: {} }) as any)).toBe(
      'How to join'
    );
  });
});

describe('content-only deck, live', () => {
  const T0 = new Date('2026-10-19T09:00:00.000Z').getTime();
  let redis: FakeRedis;
  let restoreRedis: () => void;
  let models: ReturnType<typeof installModelStubs>;

  beforeEach(() => {
    const fake = installFakeRedis();
    redis = fake.redis;
    restoreRedis = fake.restore;
    models = installModelStubs();
    setSystemTime(new Date(T0));
  });

  afterEach(async () => {
    await flush();
    models.restore();
    restoreRedis();
    setSystemTime();
  });

  it('shows every slide with slide:shown, opens no answer window and rejects answers and reveals', async () => {
    const slides = CONTENT_TYPES.map((type) => ({ ...parsed(VALID[type]), notes: `notes for ${type}` }));
    const deck = models.addPresentation({ title: 'Content only', creatorId: OWNER_ID, joinCode: '424242', slides });
    const pid = String(deck._id);
    expect(deck.slides.map((s: any) => s.kind)).toEqual(CONTENT_TYPES.map(() => 'content'));
    expect(deck.validateSync()).toBeUndefined();

    await PresentationService.openLobby(pid, OWNER_ID);
    const ada = await PresentationService.joinPresentation(pid, { name: 'Ada' });

    for (let index = 0; index < CONTENT_TYPES.length; index++) {
      await PresentationService.advanceSlide(pid, OWNER_ID);
      const shown = redis.lastEvent('slide:shown')!;
      expect(shown.audience).toBe('all');
      expect(shown.payload).toMatchObject({
        slideIndex: index,
        isLastSlide: index === CONTENT_TYPES.length - 1,
        slide: { type: CONTENT_TYPES[index], kind: 'content', scored: false, totalSlides: CONTENT_TYPES.length },
      });
      expect(deck.questionEndsAt).toBeNull();
      expect(await redis.get(`presentation:${pid}:session`)).toBeNull();
    }

    expect(redis.events('slide:shown')).toHaveLength(CONTENT_TYPES.length);
    expect(redis.events('question:started')).toEqual([]);
    expect(JSON.stringify(redis.published)).not.toContain('notes for');

    let answerError: any;
    try {
      await PresentationService.submitAnswer(pid, {
        participantId: ada.participantId,
        participantToken: ada.token,
        slideIndex: CONTENT_TYPES.length - 1,
        payload: { text: 'hi' },
      });
    } catch (error) {
      answerError = error;
    }
    expect(answerError?.statusCode).toBe(400);

    let revealError: any;
    try {
      await PresentationService.revealCurrentSlide(pid, OWNER_ID);
    } catch (error) {
      revealError = error;
    }
    expect(revealError?.message).toBe('Video slides have nothing to reveal');

    await PresentationService.endPresentation(pid, OWNER_ID);
    expect(redis.lastEvent('quiz:ended')).toBeDefined();
  });
});
