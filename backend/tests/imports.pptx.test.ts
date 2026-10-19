import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { ImportError } from '../src/modules/imports/errors';
import { mapPptxDeck } from '../src/modules/imports/pptx/map';
import { PptxReader } from '../src/modules/imports/pptx/parse';
import { PNG_1X1, SLIDE_HEIGHT, SLIDE_WIDTH, buildPptx, traversalZip, zipBomb, type PptxSpec } from './fixtures/imports/pptx';
import { SAMPLE_PPTX } from './fixtures/import/constants';

const read = (spec: PptxSpec) => PptxReader.open(buildPptx(spec)).read();
const map = (spec: PptxSpec) => mapPptxDeck(read(spec));
const payloads = (spec: PptxSpec) => map(spec).drafts.map((d) => d.slide);
const content = (slide: Record<string, unknown>) => slide.content as Record<string, any>;

describe('pptx parser', () => {
  it('reads the committed sample deck in sldIdLst order, not part-name order', () => {
    const deck = PptxReader.open(new Uint8Array(readFileSync(`${import.meta.dir}/fixtures/import/sample.pptx`))).read();
    expect(deck.title).toBe(SAMPLE_PPTX.title);
    expect(deck.slides.map((s) => s.part)).toEqual(['ppt/slides/slide2.xml', 'ppt/slides/slide1.xml']);
    expect(deck.slides[1]!.blocks.map((b) => b.kind)).toEqual(['title', 'body']);
    expect(deck.slides[1]!.blocks[1]!.paragraphs.map((p) => [p.text, p.level])).toEqual([
      ['Results', 0],
      ['Revenue & churn', 1],
      ['Next steps', 0],
    ]);
  });

  it('keeps deck order for generated packages whose parts run backwards', () => {
    const deck = read({ slides: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }] });
    expect(deck.slides.map((s) => s.blocks[0]!.paragraphs[0]!.text)).toEqual(['First', 'Second', 'Third']);
    expect(deck.slides.map((s) => s.part)).toEqual(['ppt/slides/slide3.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml']);
  });

  it('reads notes from the body placeholder only', () => {
    const deck = read({ slides: [{ title: 'T', notes: 'Say hello\nThen pause' }] });
    expect(deck.slides[0]!.notes).toBe('Say hello\nThen pause');
  });

  it('decodes entities and numeric references, and refuses DOCTYPE and entity declarations', () => {
    const slide =
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>' +
      '<p:txBody><a:p><a:r><a:t>Fish &amp; Chips &#169; &#x263A; &lt;b&gt; &unknown;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
    const deck = PptxReader.open(buildPptx({ slides: [{ title: 'x' }], parts: { 'ppt/slides/slide1.xml': slide } })).read();
    expect(deck.slides[0]!.blocks[0]!.paragraphs[0]!.text).toBe('Fish & Chips © ☺ <b> &unknown;');

    const bomb =
      '<?xml version="1.0"?><!DOCTYPE lol [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>' +
      '<p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>&b;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
    const file = buildPptx({ slides: [{ title: 'x' }], parts: { 'ppt/slides/slide1.xml': bomb } });
    expect(() => PptxReader.open(file).read()).toThrow(ImportError);
    try {
      PptxReader.open(file).read();
    } catch (error) {
      expect((error as ImportError).code).toBe('INVALID_PPTX');
    }
  });

  it('flags charts, SmartArt, EMF pictures, linked pictures and videos', () => {
    const deck = read({
      slides: [
        {
          title: 'Unsupported',
          chart: true,
          smartArt: true,
          video: true,
          pictures: [{ ext: 'emf', bytes: new Uint8Array([1, 2, 3, 4]) }],
        },
      ],
    });
    expect(deck.slides[0]!.unsupported.sort()).toEqual(['chart', 'smartart', 'vector_image', 'video']);
    expect(deck.slides[0]!.pictures).toHaveLength(0);
  });

  it('reads through mc:AlternateContent fallbacks and group shapes', () => {
    const deck = read({ slides: [{ title: 'Inside', alternateContent: true }] });
    expect(deck.slides[0]!.blocks[0]!.paragraphs[0]!.text).toBe('Inside');
  });

  it('rejects files that are not PowerPoint packages', () => {
    expect(() => PptxReader.open(new Uint8Array([1, 2, 3]))).toThrow(ImportError);
    expect(() => PptxReader.open(zipSync({ 'hello.txt': strToU8('hi') })).read()).toThrow(ImportError);
  });

  it('ignores relationships that point outside the package', () => {
    const file = buildPptx({
      slides: [{ title: 'Safe' }],
      parts: {
        'ppt/slides/_rels/slide1.xml.rels':
          '<Relationships xmlns="r"><Relationship Id="rId2" Type="http://x/image" Target="../../../../etc/passwd"/></Relationships>',
      },
    });
    expect(PptxReader.open(file).read().slides[0]!.pictures).toHaveLength(0);
  });
});

describe('pptx zip guards', () => {
  it('rejects a compression bomb before inflating it', () => {
    const started = Date.now();
    expect(() => PptxReader.open(zipBomb())).toThrow(/looks unsafe/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('stops inflating an entry that is larger than it says', () => {
    const zip = zipBomb(64 * 1024 * 1024, 'ppt/presentation.xml');
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // Declare 1000 bytes in the local header and the central directory.
    view.setUint32(22, 1000, true);
    for (let i = 0; i < zip.length - 4; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1000, true);
    const started = Date.now();
    const limits = { maxEntries: 10, maxTotalBytes: 1e6, maxEntryBytes: 1e6, maxRatio: 1e9, ratioFloorBytes: 1e6 };
    expect(() => PptxReader.open(zip, limits).read()).toThrow(/looks unsafe \(an entry is larger than it says\)/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('rejects truncated, encrypted and zip64 archives', () => {
    const good = buildPptx({ slides: [{ title: 'a' }] });
    expect(() => PptxReader.open(good.subarray(0, good.length - 40))).toThrow(ImportError);
    const encrypted = good.slice();
    const view = new DataView(encrypted.buffer);
    for (let i = 0; i < encrypted.length - 4; i++) if (view.getUint32(i, true) === 0x02014b50) view.setUint16(i + 8, 1, true);
    expect(() => PptxReader.open(encrypted)).toThrow(/encrypted/);
    const zip64 = good.slice();
    const v64 = new DataView(zip64.buffer);
    for (let i = zip64.length - 22; i >= 0; i--) if (v64.getUint32(i, true) === 0x06054b50) { v64.setUint16(i + 10, 0xffff, true); break; }
    expect(() => PptxReader.open(zip64)).toThrow(/4 GB/);
  });

  it('rejects path traversal entry names', () => {
    expect(() => PptxReader.open(traversalZip())).toThrow(/looks unsafe/);
    expect(() => PptxReader.open(traversalZip('/abs/evil.txt'))).toThrow(/looks unsafe/);
    expect(() => PptxReader.open(traversalZip('C:/evil.txt'))).toThrow(/looks unsafe/);
  });

  it('enforces the entry-count and total-size caps', () => {
    const file = buildPptx({ slides: [{ title: 'a' }, { title: 'b' }] });
    const limits = { maxEntries: 3, maxTotalBytes: 1e9, maxEntryBytes: 1e9, maxRatio: 100, ratioFloorBytes: 1e6 };
    expect(() => PptxReader.open(file, limits)).toThrow(/too many entries/);
    expect(() => PptxReader.open(file, { ...limits, maxEntries: 100, maxTotalBytes: 100 })).toThrow(/expands too much/);
    expect(() => PptxReader.open(file, { ...limits, maxEntries: 100, maxEntryBytes: 10 })).toThrow(/too large/);
  });

  it('refuses an XML part over the size cap', () => {
    const file = buildPptx({ slides: [{ title: 'x' }] });
    const limits = { maxEntries: 100, maxTotalBytes: 1e9, maxEntryBytes: 1e9, maxRatio: 100, ratioFloorBytes: 1e6, maxXmlBytes: 50 };
    expect(() => PptxReader.open(file, limits).read()).toThrow(/parts is too large/);
  });
});

describe('pptx mapping', () => {
  it('maps a title-only slide to a heading and a subtitle slide to heading + subtitle', () => {
    const slides = payloads({ slides: [{ title: 'Quarterly review' }, { title: 'Welcome', subtitle: 'Q3 2026' }] });
    expect(slides[0]).toMatchObject({ type: 'heading', content: { title: 'Quarterly review', subtitle: '' } });
    expect(slides[1]).toMatchObject({ type: 'heading', content: { title: 'Welcome', subtitle: 'Q3 2026' } });
  });

  it('maps leveled bullets to a bullets slide, nested levels get leading dashes', () => {
    const [slide] = payloads({
      slides: [{ title: 'Agenda', body: [{ text: 'Results' }, { text: 'Revenue', level: 1 }, { text: 'Detail', level: 2 }, 'Next steps'] }],
    });
    expect(slide).toMatchObject({ type: 'bullets' });
    expect(content(slide!)).toEqual({ title: 'Agenda', items: ['Results', '– Revenue', '– – Detail', 'Next steps'] });
  });

  it('maps a single unmarked body paragraph to a paragraph slide', () => {
    const [slide] = payloads({ slides: [{ title: 'Summary', body: ['We shipped the thing and the thing worked.'] }] });
    expect(slide).toMatchObject({ type: 'paragraph', content: { title: 'Summary', body: 'We shipped the thing and the thing worked.' } });
  });

  it('splits more than ten bullets across slides with a warning', () => {
    const body = Array.from({ length: 13 }, (_, i) => ({ text: `Point ${i + 1}`, bullet: true }));
    const mapped = map({ slides: [{ title: 'Long list', body }] });
    expect(mapped.drafts.map((d) => content(d.slide).items.length)).toEqual([10, 3]);
    expect(mapped.drafts.map((d) => content(d.slide).title)).toEqual(['Long list (1/2)', 'Long list (2/2)']);
    expect(mapped.drafts[0]!.warnings.map((w) => w.code)).toContain('BULLETS_SPLIT');
  });

  it('turns a table into bullets with a warning', () => {
    const mapped = map({ slides: [{ title: 'Numbers', table: [['Region', 'Sales'], ['EMEA', '10'], ['APAC', '20']] }] });
    expect(content(mapped.drafts[0]!.slide).items).toEqual(['Region | Sales', 'EMEA | 10', 'APAC | 20']);
    expect(mapped.drafts[0]!.warnings.map((w) => w.code)).toContain('TABLE_CONVERTED');
  });

  it('maps a picture-dominated slide to an image slide, title becomes the caption, notes carry over', () => {
    const mapped = map({
      slides: [{ title: 'Our office', pictures: [{ descr: 'The office at dusk' }], notes: 'Mention the move' }],
    });
    const draft = mapped.drafts[0]!;
    expect(draft.slide).toMatchObject({ type: 'image', notes: 'Mention the move' });
    expect(content(draft.slide)).toMatchObject({ alt: 'The office at dusk', caption: 'Our office', fit: 'contain' });
    expect(draft.image).toEqual({ kind: 'pptx', part: 'ppt/media/image1_1.png' });
  });

  it('keeps a small picture next to text as text and says so', () => {
    const mapped = map({
      slides: [
        {
          title: 'Logo slide',
          body: ['Some words'],
          pictures: [{ x: 0, y: 0, cx: SLIDE_WIDTH / 10, cy: SLIDE_HEIGHT / 10 }],
        },
      ],
    });
    expect(mapped.drafts[0]!.slide.type).not.toBe('image');
    expect(mapped.drafts[0]!.warnings.map((w) => w.code)).toContain('PICTURES_SKIPPED');
  });

  it('uses the text as alt text when the picture has no description', () => {
    const [slide] = payloads({ slides: [{ title: 'Chart title', body: ['Caption text'], pictures: [{}] }] });
    expect(content(slide!).alt).toBe('Chart title. Caption text');
  });

  it('warns about charts, SmartArt and video without dropping the slide text', () => {
    const mapped = map({ slides: [{ title: 'Revenue', body: ['Up and to the right'], chart: true, video: true }] });
    const draft = mapped.drafts[0]!;
    expect(draft.slide.type).toBe('paragraph');
    expect(draft.warnings.map((w) => w.code).sort()).toEqual(['CHART_NOT_IMPORTED', 'VIDEO_NOT_IMPORTED']);
    expect(draft.degraded.sort()).toEqual(['chart', 'video']);
  });

  it('skips hidden and empty slides with warnings', () => {
    const mapped = map({ slides: [{ title: 'Visible' }, { title: 'Secret', hidden: true }, {}] });
    expect(mapped.drafts.filter((d) => !d.skip).map((d) => content(d.slide).title)).toEqual(['Visible']);
    expect(mapped.warnings.map((w) => w.code)).toEqual(['SLIDE_HIDDEN']);
    expect(mapped.drafts.find((d) => d.skip)!.warnings.map((w) => w.code)).toEqual(['SLIDE_EMPTY']);
  });

  it('takes the deck title from the document properties, else the first title', () => {
    expect(map({ title: 'Board deck', slides: [{ title: 'Hello' }] }).title).toBe('Board deck');
    expect(map({ slides: [{ title: 'Hello' }] }).title).toBe('Hello');
    expect(map({ slides: [{}] }).title).toBe('Imported presentation');
  });

  it('truncates over-long text with a warning instead of failing', () => {
    const mapped = map({ slides: [{ title: 'T'.repeat(300), body: ['x'.repeat(3000)], notes: 'n'.repeat(6000) }] });
    const draft = mapped.drafts[0]!;
    expect(content(draft.slide).title.length).toBeLessThanOrEqual(150);
    expect(content(draft.slide).body.length).toBeLessThanOrEqual(2000);
    expect((draft.slide.notes as string).length).toBeLessThanOrEqual(5000);
    expect(draft.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['TEXT_TRUNCATED', 'NOTES_TRUNCATED']));
  });

  it('produces slides the registry accepts', async () => {
    const { presentationSlideSchema } = await import('../src/modules/presentations/presentations.schema');
    const mapped = map({
      slides: [
        { title: 'Intro', subtitle: 'Sub' },
        { title: 'List', body: ['a', { text: 'b', level: 1 }] },
        { title: 'Prose', body: ['Just one line.'] },
        { title: 'Pic', pictures: [{}] },
      ],
    });
    for (const draft of mapped.drafts) {
      const parsed = presentationSlideSchema.safeParse(draft.slide);
      expect(parsed.success).toBe(true);
    }
  });
});

describe('fixture sanity', () => {
  it('the tiny PNG is a PNG', () => {
    expect(Array.from(PNG_1X1.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
