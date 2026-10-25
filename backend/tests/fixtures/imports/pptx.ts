import { deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';

/**
 * Builds PPTX packages for the import tests, in memory, with fflate: a small
 * but structurally real PresentationML package (content types, package and
 * part relationships, presentation.xml with sldIdLst, slides, notes, media,
 * a chart part). Slide part names are deliberately not in deck order.
 */

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';

export const SLIDE_WIDTH = 12192000;
export const SLIDE_HEIGHT = 6858000;

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** A valid solid-colour PNG, built by hand (no image library involved). */
export function makePng(width = 1, height = 1, [r, g, b]: [number, number, number] = [255, 0, 0]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set(strToU8(type), 0);
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = new Uint8Array(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** A valid 1x1 red PNG. */
export const PNG_1X1 = makePng();

const escapeXml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface ParagraphSpec {
  text: string;
  level?: number;
  /** true = `a:buChar`, false = `a:buNone`, undefined = inherited. */
  bullet?: boolean;
}

export interface PictureSpec {
  bytes?: Uint8Array;
  /** Part extension, default png. */
  ext?: string;
  /** EMU; default fills the slide. */
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  descr?: string;
}

export interface SlideSpec {
  title?: string;
  /** `ctrTitle` + `subTitle` placeholders when set. */
  subtitle?: string;
  body?: Array<string | ParagraphSpec>;
  /** A free text box (not a placeholder). */
  textBox?: Array<string | ParagraphSpec>;
  table?: string[][];
  pictures?: PictureSpec[];
  notes?: string;
  hidden?: boolean;
  chart?: boolean;
  smartArt?: boolean;
  video?: boolean;
  /** Wraps the body in `mc:AlternateContent` (Choice + Fallback). */
  alternateContent?: boolean;
}

export interface PptxSpec {
  title?: string;
  slides: SlideSpec[];
  /** Extra or replaced parts (raw bytes or XML text), e.g. to corrupt something. */
  parts?: Record<string, string | Uint8Array | null>;
}

const rels = (entries: Array<[id: string, type: string, target: string, external?: boolean]>) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(
      ([id, type, target, external]) =>
        `<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ''}/>`,
    )
    .join('')}</Relationships>`;

const emptyTree =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const para = (spec: string | ParagraphSpec) => {
  const { text, level, bullet } = typeof spec === 'string' ? { text: spec, level: undefined, bullet: undefined } : spec;
  const props: string[] = [];
  if (bullet === true) props.push('<a:buChar char="•"/>');
  if (bullet === false) props.push('<a:buNone/>');
  const pPr = level || props.length ? `<a:pPr${level ? ` lvl="${level}"` : ''}>${props.join('')}</a:pPr>` : '';
  return `<a:p>${pPr}<a:r><a:rPr lang="en-US"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
};

const shape = (id: number, name: string, ph: string, paragraphs: Array<string | ParagraphSpec>, xfrm = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr>${ph ? '<a:spLocks noGrp="1"/>' : '<a:spLocks/>'}</p:cNvSpPr>` +
  `<p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${xfrm}</p:spPr>` +
  `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map(para).join('')}</p:txBody></p:sp>`;

const textBoxXfrm = '<a:xfrm><a:off x="838200" y="1825625"/><a:ext cx="10515600" cy="4351338"/></a:xfrm>';

const picture = (id: number, rId: string, spec: PictureSpec) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${spec.descr ? ` descr="${escapeXml(spec.descr)}"` : ''}/>` +
  '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
  `<p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
  `<p:spPr><a:xfrm><a:off x="${spec.x ?? 0}" y="${spec.y ?? 0}"/><a:ext cx="${spec.cx ?? SLIDE_WIDTH}" cy="${spec.cy ?? SLIDE_HEIGHT}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';

const graphicFrame = (id: number, uri: string, inner: string) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Frame ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
  '<p:xfrm><a:off x="838200" y="1825625"/><a:ext cx="6000000" cy="3000000"/></p:xfrm>' +
  `<a:graphic><a:graphicData uri="${uri}">${inner}</a:graphicData></a:graphic></p:graphicFrame>`;

const tableXml = (rows: string[][]) =>
  `<a:tbl><a:tblGrid>${(rows[0] ?? []).map(() => '<a:gridCol w="1000000"/>').join('')}</a:tblGrid>${rows
    .map(
      (row) =>
        `<a:tr h="370840">${row
          .map((cell) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapeXml(cell)}</a:t></a:r></a:p></a:txBody></a:tc>`)
          .join('')}</a:tr>`,
    )
    .join('')}</a:tbl>`;

interface Built {
  parts: Record<string, string | Uint8Array>;
}

function buildSlide(index: number, spec: SlideSpec, built: Built): { xml: string; relEntries: Array<[string, string, string]> } {
  const relEntries: Array<[string, string, string]> = [['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml']];
  let nextRel = 2;
  let nextId = 2;
  const shapes: string[] = [];

  if (spec.subtitle !== undefined) {
    if (spec.title !== undefined) shapes.push(shape(nextId++, 'Title', '<p:ph type="ctrTitle"/>', [spec.title]));
    shapes.push(shape(nextId++, 'Subtitle', '<p:ph type="subTitle" idx="1"/>', [spec.subtitle]));
  } else if (spec.title !== undefined) {
    shapes.push(shape(nextId++, 'Title', '<p:ph type="title"/>', [spec.title]));
  }
  if (spec.body) shapes.push(shape(nextId++, 'Content', '<p:ph idx="1"/>', spec.body));
  if (spec.textBox) shapes.push(shape(nextId++, 'TextBox', '', spec.textBox, textBoxXfrm));
  if (spec.table) {
    shapes.push(graphicFrame(nextId++, 'http://schemas.openxmlformats.org/drawingml/2006/table', tableXml(spec.table)));
  }
  (spec.pictures ?? []).forEach((pic, pictureIndex) => {
    const ext = pic.ext ?? 'png';
    const part = `ppt/media/image${index}_${pictureIndex + 1}.${ext}`;
    built.parts[part] = pic.bytes ?? PNG_1X1;
    const rId = `rId${nextRel++}`;
    relEntries.push([rId, `${REL}/image`, `../media/image${index}_${pictureIndex + 1}.${ext}`]);
    shapes.push(picture(nextId++, rId, pic));
  });
  if (spec.chart) {
    const rId = `rId${nextRel++}`;
    built.parts[`ppt/charts/chart${index}.xml`] = `${XML}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>`;
    relEntries.push([rId, `${REL}/chart`, `../charts/chart${index}.xml`]);
    shapes.push(
      graphicFrame(nextId++, 'http://schemas.openxmlformats.org/drawingml/2006/chart', `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/>`),
    );
  }
  if (spec.smartArt) {
    shapes.push(
      graphicFrame(nextId++, 'http://schemas.openxmlformats.org/drawingml/2006/diagram', '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>'),
    );
  }
  if (spec.video) {
    shapes.push(
      '<p:pic><p:nvPicPr><p:cNvPr id="90" name="Video"/><p:cNvPicPr/><p:nvPr><a:videoFile r:link="rId90"/></p:nvPr></p:nvPicPr>' +
        '<p:blipFill><a:blip/></p:blipFill><p:spPr/></p:pic>',
    );
  }

  let tree = shapes.join('');
  if (spec.alternateContent) {
    tree = `<mc:AlternateContent><mc:Choice Requires="p14"><p:sp><p:nvSpPr><p:cNvPr id="80" name="x"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp></mc:Choice><mc:Fallback>${tree}</mc:Fallback></mc:AlternateContent>`;
  }

  const xml =
    `${XML}<p:sld ${NS}${spec.hidden ? ' show="0"' : ''}><p:cSld><p:spTree>${emptyTree}${tree}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';

  if (spec.notes !== undefined) {
    const notesPart = `ppt/notesSlides/notesSlide${index}.xml`;
    built.parts[notesPart] =
      `${XML}<p:notes ${NS}><p:cSld><p:spTree>${emptyTree}` +
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
      shape(3, 'Notes', '<p:ph type="body" idx="1"/>', spec.notes.split('\n')) +
      shape(4, 'Slide Number', '<p:ph type="sldNum" idx="5"/>', ['7']) +
      '</p:spTree></p:cSld></p:notes>';
    built.parts[`ppt/notesSlides/_rels/notesSlide${index}.xml.rels`] = rels([
      ['rId1', `${REL}/slide`, `../slides/slide${index}.xml`],
    ]);
    relEntries.push([`rId${nextRel++}`, `${REL}/notesSlide`, `../notesSlides/notesSlide${index}.xml`]);
  }
  return { xml, relEntries };
}

/** The package as bytes. Slide part names run backwards (the last slide is `slide1.xml`). */
export function buildPptx(spec: PptxSpec): Uint8Array {
  const built: Built = { parts: {} };
  const count = spec.slides.length;
  const partName = (deckIndex: number) => count - deckIndex; // deck slide 0 → slideN.xml

  const slideRels: Array<[string, string, string]> = [];
  const sldIds: string[] = [];
  spec.slides.forEach((slideSpec, deckIndex) => {
    const n = partName(deckIndex);
    const { xml, relEntries } = buildSlide(n, slideSpec, built);
    built.parts[`ppt/slides/slide${n}.xml`] = xml;
    built.parts[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(relEntries);
    slideRels.push([`rId${deckIndex + 10}`, `${REL}/slide`, `slides/slide${n}.xml`]);
    sldIds.push(`<p:sldId id="${256 + deckIndex}" r:id="rId${deckIndex + 10}"/>`);
  });

  const parts: Record<string, string | Uint8Array> = {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/></Types>`,
    '_rels/.rels': rels([
      ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
    ]),
    'docProps/core.xml':
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `${spec.title ? `<dc:title>${escapeXml(spec.title)}</dc:title>` : ''}</cp:coreProperties>`,
    'ppt/presentation.xml':
      `${XML}<p:presentation ${NS}><p:sldIdLst>${sldIds.join('')}</p:sldIdLst>` +
      `<p:sldSz cx="${SLIDE_WIDTH}" cy="${SLIDE_HEIGHT}"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels(slideRels),
    'ppt/slideLayouts/slideLayout1.xml': `${XML}<p:sldLayout ${NS}><p:cSld><p:spTree>${emptyTree}</p:spTree></p:cSld></p:sldLayout>`,
    ...built.parts,
  };
  for (const [name, value] of Object.entries(spec.parts ?? {})) {
    if (value === null) delete parts[name];
    else parts[name] = value;
  }
  return zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([name, value]) => [name, [typeof value === 'string' ? strToU8(value) : value, { mtime: new Date('2026-01-01T00:00:00Z') }]]),
    ),
    { level: 6 },
  );
}

/** A zip whose single entry inflates to `size` bytes of zeros: a classic compression bomb. */
export function zipBomb(size = 8 * 1024 * 1024, name = 'ppt/presentation.xml'): Uint8Array {
  return zipSync({ [name]: [new Uint8Array(size), { level: 9 }] });
}

/** A zip with a path-traversal entry name. */
export function traversalZip(name = '../../evil.txt'): Uint8Array {
  return zipSync({ [name]: strToU8('x'), 'ppt/presentation.xml': strToU8('<p:presentation xmlns:p="x"/>') });
}
