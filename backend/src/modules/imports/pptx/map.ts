import { warning, type ImportWarning } from '../errors';
import { IMPORT_LIMITS } from '../limits';
import { clip, oneLine, stripControl, truncate } from '../text';
import type { PptxDeck, PptxParagraph, PptxPicture, PptxSlide, PptxUnsupportedKind } from './parse';

/**
 * Turns the parsed deck into OpenPoll slides (request shape, before the
 * registry schema fills its defaults). Mapping table (also in
 * backend/docs/wiki/modules/imports.md):
 *
 * | PowerPoint | OpenPoll |
 * | --- | --- |
 * | title (+ subtitle), nothing else | `heading` |
 * | title + bulleted / leveled body | `bullets` (10 per slide; deeper levels get leading dashes) |
 * | title + plain text | `paragraph` |
 * | table | `bullets`, one item per row |
 * | picture covering ≥ 40 % of the slide | `image` (title → caption, text → alt) |
 * | notes page | `notes` |
 * | chart, SmartArt, OLE, EMF/WMF, video, audio, ink, linked picture | warning (+ rendered picture when a renderer is configured) |
 * | hidden slide, empty slide, slides past the deck cap | skipped with a warning |
 */

export type SlideDraftPayload = Record<string, unknown>;

/** Where the bytes of an image slide come from. */
export type ImageSource = { kind: 'pptx'; part: string } | { kind: 'bytes'; bytes: Uint8Array };

export interface DraftSlide {
  slide: SlideDraftPayload;
  /** 1-based slide (or page) in the source file. */
  source: number;
  /** Set on image slides: the picture to store and attach. */
  image?: ImageSource;
  /** What the native mapping could not carry over (the rendered picture is the fallback). */
  degraded: PptxUnsupportedKind[];
  /** Warnings about this slide only. */
  warnings: ImportWarning[];
  /** Nothing to build natively: dropped unless a rendered picture replaces it. */
  skip?: true;
}

export interface MappedDeck {
  title: string;
  drafts: DraftSlide[];
  /** Warnings about the deck as a whole. */
  warnings: ImportWarning[];
}

export interface MapOptions {
  pictureDominantRatio?: number;
}

const MAX_BULLETS = 10;
const MAX_BULLET_TEXT = 200;
const MAX_TITLE = 150;
const MAX_PARAGRAPH = 2000;
const MAX_NOTES = 5000;
const MAX_ALT = 500;
const MAX_CAPTION = 300;
const MAX_DECK_TITLE = 120;
const FALLBACK_DECK_TITLE = 'Imported presentation';
/** Titles an office program writes when nobody named the file ("PowerPoint Presentation", "Presentation1", "Untitled"). */
const isDefaultTitle = (title: string) =>
  /^(power ?point presentation|presentation ?\d*|untitled( presentation)?( \d+)?|slides?|new presentation)$/i.test(title.trim());

const UNSUPPORTED_TEXT: Record<PptxUnsupportedKind, string> = {
  chart: 'a chart (OpenPoll cannot edit PowerPoint charts)',
  smartart: 'a SmartArt diagram',
  ole: 'an embedded object',
  video: 'a video',
  audio: 'audio',
  ink: 'ink or drawing content',
  vector_image: 'a picture in a format browsers cannot show (EMF/WMF)',
  linked_image: 'a picture linked from outside the file',
  graphic: 'a graphic OpenPoll cannot read',
};

const UNSUPPORTED_CODE: Record<PptxUnsupportedKind, string> = {
  chart: 'CHART_NOT_IMPORTED',
  smartart: 'SMARTART_NOT_IMPORTED',
  ole: 'OBJECT_NOT_IMPORTED',
  video: 'VIDEO_NOT_IMPORTED',
  audio: 'AUDIO_NOT_IMPORTED',
  ink: 'INK_NOT_IMPORTED',
  vector_image: 'VECTOR_IMAGE_NOT_IMPORTED',
  linked_image: 'LINKED_IMAGE_NOT_IMPORTED',
  graphic: 'GRAPHIC_NOT_IMPORTED',
};

interface BodyParagraph extends PptxParagraph {
  /** The placeholder the paragraph came from decides whether it is a bullet by default. */
  placeholder: boolean;
  table: boolean;
}

const isListLike = (paragraphs: BodyParagraph[]) => {
  if (paragraphs.some((p) => p.table)) return true;
  if (paragraphs.some((p) => p.level > 0)) return true;
  if (paragraphs.some((p) => p.bullet === true)) return true;
  // A body placeholder with several unmarked paragraphs inherits its bullets from the layout.
  const inherited = paragraphs.filter((p) => p.bullet === null && p.placeholder);
  return inherited.length >= 2;
};

const dashPrefix = (level: number) => (level > 0 ? '– '.repeat(level) : '');

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** The largest picture, when it covers enough of the slide to be "the slide". */
function dominantPicture(
  pictures: PptxPicture[],
  slideArea: number,
  ratio: number,
  hasText: boolean,
): PptxPicture | null {
  if (pictures.length === 0) return null;
  const largest = pictures.reduce((best, picture) => (picture.area > best.area ? picture : best));
  if (largest.area > 0 && slideArea > 0) return largest.area / slideArea >= ratio ? largest : null;
  // Size unknown (the picture inherits its frame): it is the slide when there is no text beside it.
  return hasText ? null : largest;
}

const withNotes = (slide: SlideDraftPayload, notes: string, warnings: ImportWarning[], source: number) => {
  const { text, cut } = truncate(notes, MAX_NOTES);
  slide.notes = text;
  if (cut) warnings.push(warning('NOTES_TRUNCATED', `Slide ${source}: the speaker notes were shortened to ${MAX_NOTES} characters.`, source));
};

function mapSlide(slide: PptxSlide, deck: PptxDeck, options: Required<MapOptions>): DraftSlide[] {
  const warnings: ImportWarning[] = [];
  const source = slide.number;

  const titles = slide.blocks.filter((b) => b.kind === 'title');
  const subtitles = slide.blocks.filter((b) => b.kind === 'subtitle');
  const rest = slide.blocks.filter((b) => b.kind === 'body' || b.kind === 'text');

  const rawTitle = oneLine(titles.flatMap((b) => b.paragraphs.map((p) => p.text)).join(' '));
  const rawSubtitle = oneLine(subtitles.flatMap((b) => b.paragraphs.map((p) => p.text)).join(' '));
  const body: BodyParagraph[] = rest.flatMap((block) =>
    block.paragraphs
      .filter((p) => p.text.length > 0)
      .map((p) => ({ ...p, placeholder: block.kind === 'body', table: block.fromTable === true })),
  );
  if (rest.some((block) => block.fromTable)) {
    warnings.push(warning('TABLE_CONVERTED', `Slide ${source}: a table was imported as text, one line per row.`, source));
  }

  const hasText = rawTitle.length > 0 || rawSubtitle.length > 0 || body.length > 0;
  const slideArea = deck.width * deck.height;
  const picture = dominantPicture(slide.pictures, slideArea, options.pictureDominantRatio, body.length > 0);

  const done = (slides: SlideDraftPayload[], image?: DraftSlide['image']): DraftSlide[] =>
    slides.map((payload, index) => {
      withNotes(payload, slide.notes, warnings, source);
      return {
        slide: payload,
        source,
        ...(image && index === 0 ? { image } : {}),
        degraded: slide.unsupported,
        warnings: index === 0 ? warnings : [],
      };
    });

  for (const kind of slide.unsupported) {
    warnings.push(warning(UNSUPPORTED_CODE[kind], `Slide ${source} has ${UNSUPPORTED_TEXT[kind]}, which was not imported.`, source));
  }

  // ---- Picture slide ----
  if (picture) {
    const parts = [rawTitle, rawSubtitle, ...body.map((p) => p.text)].filter(Boolean);
    const joined = oneLine(parts.join('. '));
    const alt = clip(picture.descr || joined || `Slide ${source}`, MAX_ALT);
    if (!picture.descr && joined.length > MAX_ALT) {
      warnings.push(warning('TEXT_TRUNCATED', `Slide ${source}: text next to the picture was shortened in the picture's description.`, source));
    }
    const caption = rawTitle && rawTitle !== alt ? clip(rawTitle, MAX_CAPTION) : '';
    if (slide.pictures.length > 1) {
      warnings.push(
        warning('PICTURES_SKIPPED', `Slide ${source}: only the largest of ${slide.pictures.length} pictures was imported.`, source),
      );
    }
    return done(
      [{ type: 'image', question: '', timeLimit: 0, content: { key: null, url: null, alt, fit: 'contain', caption } }],
      { kind: 'pptx', part: picture.part },
    );
  }
  if (slide.pictures.length > 0) {
    warnings.push(
      warning(
        'PICTURES_SKIPPED',
        `Slide ${source}: ${slide.pictures.length === 1 ? 'a picture' : `${slide.pictures.length} pictures`} next to text ${slide.pictures.length === 1 ? 'was' : 'were'} not imported (an OpenPoll slide holds text or one picture).`,
        source,
      ),
    );
  }

  if (!hasText) {
    if (slide.unsupported.length === 0) {
      warnings.push(warning('SLIDE_EMPTY', `Slide ${source} is empty and was skipped.`, source));
    }
    // Nothing to build natively: the rendered fallback (if any) replaces it, else it is dropped.
    return [{ slide: {}, source, degraded: slide.unsupported, warnings, skip: true }];
  }

  const title = clip(rawTitle, MAX_TITLE);
  if (rawTitle.length > MAX_TITLE) {
    warnings.push(warning('TEXT_TRUNCATED', `Slide ${source}: the title was shortened to ${MAX_TITLE} characters.`, source));
  }

  // ---- Heading ----
  if (body.length === 0) {
    const headline = title || clip(rawSubtitle, MAX_TITLE);
    const subtitle = title ? clip(rawSubtitle, 300) : '';
    return done([{ type: 'heading', question: '', timeLimit: 0, content: { title: headline, subtitle } }]);
  }

  // A subtitle beside a body reads as the body's first line.
  const paragraphs: BodyParagraph[] = rawSubtitle
    ? [{ text: rawSubtitle, level: 0, bullet: false, placeholder: false, table: false }, ...body]
    : body;

  // ---- Bullets ----
  if (isListLike(paragraphs) && paragraphs.every((p) => p.text.length <= MAX_BULLET_TEXT + 40)) {
    const items = paragraphs.map((p) => {
      const text = `${dashPrefix(p.level)}${oneLine(p.text)}`;
      const { text: fitted, cut } = truncate(text, MAX_BULLET_TEXT);
      if (cut) warnings.push(warning('TEXT_TRUNCATED', `Slide ${source}: a long bullet was shortened to ${MAX_BULLET_TEXT} characters.`, source));
      return fitted;
    });
    const groups = chunk(items, MAX_BULLETS);
    if (groups.length > 1) {
      warnings.push(
        warning('BULLETS_SPLIT', `Slide ${source} has ${items.length} bullets; it became ${groups.length} slides of at most ${MAX_BULLETS}.`, source),
      );
    }
    return done(
      groups.map((group, index) => ({
        type: 'bullets',
        question: '',
        timeLimit: 0,
        content: {
          title: groups.length > 1 && title ? clip(`${title} (${index + 1}/${groups.length})`, MAX_TITLE) : title,
          items: group,
        },
      })),
    );
  }

  // ---- Paragraph ----
  const text = paragraphs.map((p) => stripControl(p.text).trim()).filter(Boolean).join('\n\n');
  const { text: fitted, cut } = truncate(text, MAX_PARAGRAPH);
  if (cut) warnings.push(warning('TEXT_TRUNCATED', `Slide ${source}: the text was shortened to ${MAX_PARAGRAPH} characters.`, source));
  return done([{ type: 'paragraph', question: '', timeLimit: 0, content: { title, body: fitted } }]);
}

export function mapPptxDeck(deck: PptxDeck, options: MapOptions = {}): MappedDeck {
  const resolved: Required<MapOptions> = {
    pictureDominantRatio: options.pictureDominantRatio ?? IMPORT_LIMITS.pptx.pictureDominantRatio,
  };
  const warnings: ImportWarning[] = [];
  const drafts: DraftSlide[] = [];

  for (const slide of deck.slides) {
    if (slide.hidden) {
      warnings.push(warning('SLIDE_HIDDEN', `Slide ${slide.number} is hidden in the source and was skipped.`, slide.number));
      continue;
    }
    drafts.push(...mapSlide(slide, deck, resolved));
  }

  const firstTitle = drafts.find((d) => d.slide.type === 'heading' || d.slide.type === 'bullets' || d.slide.type === 'paragraph');
  const fromContent = firstTitle ? oneLine(String((firstTitle.slide.content as { title?: string } | undefined)?.title ?? '')) : '';
  const documentTitle = oneLine(deck.title ?? '');
  const title = clip((isDefaultTitle(documentTitle) ? '' : documentTitle) || fromContent || FALLBACK_DECK_TITLE, MAX_DECK_TITLE);

  return { title, drafts, warnings };
}
