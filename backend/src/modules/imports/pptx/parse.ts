import { posix } from 'node:path';
import { ImportError } from '../errors';
import { IMPORT_LIMITS } from '../limits';
import { SafeZip, type ZipLimits } from '../zip';
import {
  child,
  childrenNamed,
  descendants,
  elements,
  ownText,
  parseXml,
  path,
  type XmlElement,
} from '../xml';

/**
 * PresentationML → a plain description of each slide (text blocks, pictures,
 * notes, what could not be read). No mapping decisions here: `map.ts` turns
 * this into OpenPoll slides.
 *
 * Deck order comes from `presentation.xml` `sldIdLst` through the package
 * relationships, never from part names.
 */

export interface PptxParagraph {
  text: string;
  /** `a:pPr@lvl`, 0–8. */
  level: number;
  /** Explicit bullet (`a:buChar`/`a:buAutoNum`), explicit none (`a:buNone`) or inherited (null). */
  bullet: boolean | null;
}

export type PptxBlockKind = 'title' | 'subtitle' | 'body' | 'text';

export interface PptxTextBlock {
  kind: PptxBlockKind;
  paragraphs: PptxParagraph[];
  /** EMU offset when the shape has its own transform (placeholders often inherit it). */
  x: number | null;
  y: number | null;
  /** Document order on the slide. */
  order: number;
  /** Converted from a table (cells joined per row). */
  fromTable?: boolean;
}

export interface PptxPicture {
  /** Package path of the image part. */
  part: string;
  /** Lower-cased file extension of the part. */
  ext: string;
  /** EMU² covered on the slide (0 when unknown). */
  area: number;
  /** Author alt text (`p:cNvPr@descr`). */
  descr: string;
  order: number;
}

export type PptxUnsupportedKind =
  | 'chart'
  | 'smartart'
  | 'ole'
  | 'video'
  | 'audio'
  | 'ink'
  | 'vector_image'
  | 'linked_image'
  | 'graphic';

export interface PptxSlide {
  /** 1-based position in the deck (hidden slides included). */
  number: number;
  part: string;
  hidden: boolean;
  blocks: PptxTextBlock[];
  pictures: PptxPicture[];
  notes: string;
  unsupported: PptxUnsupportedKind[];
}

export interface PptxDeck {
  title: string | null;
  /** Slide size in EMU. */
  width: number;
  height: number;
  slides: PptxSlide[];
}

const REL_OFFICE_DOCUMENT = /\/officeDocument$/;
const REL_SLIDE = /\/slide$/;
const REL_NOTES = /\/notesSlide$/;

const GRAPHIC_KINDS: Array<[RegExp, PptxUnsupportedKind | 'table']> = [
  [/drawingml\/2006\/chart$/, 'chart'],
  [/drawing\/2014\/chartex$/, 'chart'],
  [/drawingml\/2006\/diagram$/, 'smartart'],
  [/drawingml\/2006\/table$/, 'table'],
  [/presentationml\/2006\/ole$/, 'ole'],
];

/** The error for a file that is not a readable PowerPoint package. */
export const invalidPptx = (detail?: string) =>
  new ImportError(
    'INVALID_PPTX',
    `This file could not be read as a PowerPoint presentation (.pptx)${detail ? `: ${detail}` : ''}. ` +
      'Save it as .pptx in PowerPoint, Keynote or Google Slides and try again.',
  );

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

/** Package-relative path of `target` resolved against `fromPart`, or null when it escapes the package. */
export function resolveTarget(fromPart: string, target: string): string | null {
  const resolved = target.startsWith('/')
    ? posix.normalize(target.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromPart), target));
  if (resolved.startsWith('../') || resolved === '..' || resolved.startsWith('/') || resolved === '.') return null;
  return resolved;
}

const relsPathOf = (part: string) => posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`);

const emu = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export class PptxReader {
  private readonly xmlCache = new Map<string, XmlElement | null>();

  constructor(readonly zip: SafeZip) {}

  static open(data: Uint8Array, limits: ZipLimits = IMPORT_LIMITS.zip): PptxReader {
    return new PptxReader(SafeZip.open(data, (detail) => invalidPptx(detail), limits));
  }

  /** A parsed XML part, or null when missing. Parts over the XML cap are refused. */
  xml(part: string): XmlElement | null {
    if (this.xmlCache.has(part)) return this.xmlCache.get(part)!;
    const info = this.zip.info(part);
    if (info && info.originalSize > (this.zip.limits.maxXmlBytes ?? IMPORT_LIMITS.zip.maxXmlBytes)) {
      throw new ImportError('ARCHIVE_REJECTED', 'This file was rejected because one of its parts is too large.');
    }
    const bytes = this.zip.read(part);
    const parsed = bytes ? parseXml(bytes, () => invalidPptx(`${part} is malformed`)) : null;
    this.xmlCache.set(part, parsed);
    return parsed;
  }

  rels(part: string): Map<string, Relationship> {
    const rels = new Map<string, Relationship>();
    const root = this.xml(relsPathOf(part));
    for (const rel of childrenNamed(root, 'Relationship')) {
      const id = rel.attrs.Id;
      const target = rel.attrs.Target;
      if (!id || !target) continue;
      const external = rel.attrs.TargetMode === 'External';
      const resolved = external ? target : resolveTarget(part, target);
      if (resolved === null) continue;
      rels.set(id, { type: rel.attrs.Type ?? '', target: resolved, external });
    }
    return rels;
  }

  /** Reads the whole deck. */
  read(): PptxDeck {
    const packageRels = this.rels('');
    const main = [...packageRels.values()].find((rel) => REL_OFFICE_DOCUMENT.test(rel.type) && !rel.external);
    const presentationPart = main?.target ?? 'ppt/presentation.xml';
    const presentation = this.xml(presentationPart);
    if (!presentation || presentation.name !== 'p:presentation') throw invalidPptx('no presentation part');

    const size = child(presentation, 'p:sldSz');
    const width = emu(size?.attrs.cx) ?? 12192000;
    const height = emu(size?.attrs.cy) ?? 6858000;

    const presentationRels = this.rels(presentationPart);
    const ids = childrenNamed(child(presentation, 'p:sldIdLst'), 'p:sldId');
    const parts: string[] = [];
    for (const id of ids) {
      const rel = presentationRels.get(id.attrs['r:id'] ?? '');
      if (rel && !rel.external && REL_SLIDE.test(rel.type) && this.zip.has(rel.target)) parts.push(rel.target);
    }

    const slides = parts.map((part, index) => this.readSlide(part, index + 1));
    return { title: this.readTitle(), width, height, slides };
  }

  private readTitle(): string | null {
    const core = this.xml('docProps/core.xml');
    const title = clean(ownText(child(core, 'dc:title')));
    return title || null;
  }

  readSlide(part: string, number: number): PptxSlide {
    const root = this.xml(part);
    if (!root || root.name !== 'p:sld') throw invalidPptx(`slide ${number} is missing`);
    const rels = this.rels(part);
    const slide: PptxSlide = {
      number,
      part,
      hidden: root.attrs.show === '0' || root.attrs.show === 'false',
      blocks: [],
      pictures: [],
      notes: '',
      unsupported: [],
    };
    const tree = path(root, 'p:cSld', 'p:spTree');
    let order = 0;
    const flag = (kind: PptxUnsupportedKind) => {
      if (!slide.unsupported.includes(kind)) slide.unsupported.push(kind);
    };

    const walk = (container: XmlElement | null) => {
      for (const node of elements(container)) {
        switch (node.name) {
          case 'p:sp': {
            const block = readShape(node, order++);
            if (block) slide.blocks.push(block);
            break;
          }
          case 'p:pic':
            this.readPicture(node, rels, order++, slide, flag);
            break;
          case 'p:graphicFrame':
            readFrame(node, order++, slide, flag);
            break;
          case 'p:grpSp':
            walk(node);
            break;
          case 'mc:AlternateContent':
            // Read what a consumer without the extension shows.
            walk(child(node, 'mc:Fallback') ?? child(node, 'mc:Choice'));
            break;
          case 'p:contentPart':
            flag('ink');
            break;
          default:
            break;
        }
      }
    };
    walk(tree);

    const notesRel = [...rels.values()].find((rel) => REL_NOTES.test(rel.type) && !rel.external);
    if (notesRel) slide.notes = this.readNotes(notesRel.target);
    return slide;
  }

  private readPicture(
    node: XmlElement,
    rels: Map<string, Relationship>,
    order: number,
    slide: PptxSlide,
    flag: (kind: PptxUnsupportedKind) => void,
  ) {
    const nvPr = path(node, 'p:nvPicPr', 'p:nvPr');
    if (child(nvPr, 'a:videoFile') || child(nvPr, 'a:quickTimeFile')) return flag('video');
    if (child(nvPr, 'a:audioFile') || child(nvPr, 'a:audioCd') || child(nvPr, 'a:wavAudioFile')) return flag('audio');
    const media = descendants(nvPr, 'p14:media')[0];
    if (media) {
      const rel = rels.get(media.attrs['r:embed'] ?? media.attrs['r:link'] ?? '');
      return flag(rel && /audio/i.test(rel.type) ? 'audio' : 'video');
    }

    const blip = path(node, 'p:blipFill', 'a:blip');
    if (!blip) return;
    const embedded = blip.attrs['r:embed'];
    if (!embedded) {
      if (blip.attrs['r:link']) flag('linked_image');
      return;
    }
    const rel = rels.get(embedded);
    if (!rel) return;
    if (rel.external) return flag('linked_image');
    if (!this.zip.has(rel.target)) return;

    const ext = posix.extname(rel.target).slice(1).toLowerCase();
    if (ext === 'emf' || ext === 'wmf' || ext === 'emz' || ext === 'wmz') return flag('vector_image');
    const xfrm = path(node, 'p:spPr', 'a:xfrm');
    const extent = child(xfrm, 'a:ext');
    const area = (emu(extent?.attrs.cx) ?? 0) * (emu(extent?.attrs.cy) ?? 0);
    slide.pictures.push({
      part: rel.target,
      ext,
      area: Math.max(0, area),
      descr: clean(path(node, 'p:nvPicPr', 'p:cNvPr')?.attrs.descr ?? ''),
      order,
    });
  }

  private readNotes(part: string): string {
    const root = this.xml(part);
    const tree = path(root, 'p:cSld', 'p:spTree');
    const texts: string[] = [];
    for (const shape of descendants(tree, 'p:sp')) {
      const ph = path(shape, 'p:nvSpPr', 'p:nvPr', 'p:ph');
      // The notes body placeholder; the slide image and the slide number are other placeholders.
      if (!ph || ph.attrs.type !== 'body') continue;
      const paragraphs = readParagraphs(child(shape, 'p:txBody')).map((p) => p.text);
      texts.push(paragraphs.join('\n'));
    }
    return texts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
}

// ---------- Shapes ----------

/** Collapses runs of spaces and tabs; keeps the text otherwise as typed. */
export const clean = (value: string) => value.replace(/[\t  ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

const SKIPPED_PLACEHOLDERS = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg']);

function blockKind(shape: XmlElement): PptxBlockKind | null {
  const ph = path(shape, 'p:nvSpPr', 'p:nvPr', 'p:ph');
  if (!ph) return 'text';
  const type = ph.attrs.type ?? 'body';
  if (SKIPPED_PLACEHOLDERS.has(type)) return null;
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (type === 'subTitle') return 'subtitle';
  return 'body';
}

function paragraphText(paragraph: XmlElement): string {
  let text = '';
  for (const node of elements(paragraph)) {
    if (node.name === 'a:r') text += ownText(child(node, 'a:t'));
    else if (node.name === 'a:br') text += '\n';
    else if (node.name === 'a:fld' && node.attrs.type !== 'slidenum') text += ownText(child(node, 'a:t'));
  }
  return clean(text);
}

export function readParagraphs(txBody: XmlElement | null): PptxParagraph[] {
  return childrenNamed(txBody, 'a:p').map((paragraph) => {
    const pPr = child(paragraph, 'a:pPr');
    const lvl = Number(pPr?.attrs.lvl ?? 0);
    let bullet: boolean | null = null;
    if (child(pPr, 'a:buNone')) bullet = false;
    else if (child(pPr, 'a:buChar') || child(pPr, 'a:buAutoNum') || child(pPr, 'a:buBlip')) bullet = true;
    return {
      text: paragraphText(paragraph),
      level: Number.isInteger(lvl) && lvl >= 0 && lvl <= 8 ? lvl : 0,
      bullet,
    };
  });
}

function offsetOf(xfrm: XmlElement | null): { x: number | null; y: number | null } {
  const off = child(xfrm, 'a:off');
  return { x: emu(off?.attrs.x), y: emu(off?.attrs.y) };
}

function readShape(shape: XmlElement, order: number): PptxTextBlock | null {
  const kind = blockKind(shape);
  if (!kind) return null;
  const paragraphs = readParagraphs(child(shape, 'p:txBody')).filter((p) => p.text.length > 0);
  if (paragraphs.length === 0) return null;
  return { kind, paragraphs, ...offsetOf(path(shape, 'p:spPr', 'a:xfrm')), order };
}

function readFrame(
  frame: XmlElement,
  order: number,
  slide: PptxSlide,
  flag: (kind: PptxUnsupportedKind) => void,
) {
  const data = path(frame, 'a:graphic', 'a:graphicData');
  const uri = data?.attrs.uri ?? '';
  const kind = GRAPHIC_KINDS.find(([pattern]) => pattern.test(uri))?.[1] ?? 'graphic';
  if (kind !== 'table') return flag(kind);

  // Tables become text: one line per row, cells joined with " | ".
  const rows = descendants(data, 'a:tr').map((row) =>
    childrenNamed(row, 'a:tc')
      .map((cell) => readParagraphs(child(cell, 'a:txBody')).map((p) => p.text).filter(Boolean).join(' '))
      .filter(Boolean)
      .join(' | '),
  );
  const paragraphs = rows.filter(Boolean).map((text) => ({ text, level: 0, bullet: false }));
  if (paragraphs.length === 0) return;
  slide.blocks.push({ kind: 'text', paragraphs, ...offsetOf(child(frame, 'p:xfrm')), order, fromTable: true });
}
