/**
 * Regenerates the import fixtures in this directory:
 *
 *   cd backend && bun tests/fixtures/import/generate.ts
 *
 * - sample.pdf (pdfkit): two A6 pages. Page 1 has a title, a line of body
 *   text and a filled red square at a known position; page 2 has one line.
 * - sample.pptx (fflate): a minimal but complete PresentationML package
 *   (master, layout, theme, doc props) with two slides. The deck order comes
 *   from `sldIdLst` and deliberately differs from the part names: slide 1 is
 *   ppt/slides/slide2.xml (title only), slide 2 is ppt/slides/slide1.xml
 *   (title + bullets with a nested level).
 *
 * Contents are described by SAMPLE_PDF / SAMPLE_PPTX in ./constants.ts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import { SAMPLE_PDF, SAMPLE_PPTX } from './constants';

const dir = import.meta.dir;
const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

async function buildPdf(): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A6',
    margin: 24,
    info: { Title: 'OpenPoll import fixture', CreationDate: FIXED_DATE, ModDate: FIXED_DATE },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const [first, second] = SAMPLE_PDF.pages;
  doc.fontSize(18).text(first!.title);
  doc.fontSize(11).text(first!.body);
  const { x, y, size } = SAMPLE_PDF.redSquare;
  doc.rect(x, y, size, size).fill('#ff0000');
  doc.addPage();
  doc.fillColor('#000000').fontSize(18).text(second!.title);
  doc.end();
  return done;
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';

const rels = (entries: Array<[id: string, type: string, target: string]>) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join('')}</Relationships>`;

const emptyTree =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const shape = (id: number, name: string, ph: string, y: number, cy: number, paragraphs: string[]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
  `<p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
  `<p:spPr><a:xfrm><a:off x="838200" y="${y}"/><a:ext cx="10515600" cy="${cy}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
  `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.join('')}</p:txBody></p:sp>`;

const run = (text: string, level?: number) =>
  `<a:p>${level ? `<a:pPr lvl="${level}"/>` : ''}<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;

const slideXml = (title: string, bullets: ReadonlyArray<{ text: string; level: number }>) => {
  const shapes = [shape(2, 'Title 1', '<p:ph type="title"/>', 365125, 1325563, [run(title)])];
  if (bullets.length > 0) {
    shapes.push(
      shape(3, 'Content Placeholder 2', '<p:ph idx="1"/>', 1825625, 4351338, bullets.map((b) => run(b.text, b.level))),
    );
  }
  return (
    `${XML}<p:sld ${NS}><p:cSld><p:spTree>${emptyTree}${shapes.join('')}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
  );
};

const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const theme =
  `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OpenPoll Fixture"><a:themeElements>` +
  '<a:clrScheme name="OpenPoll">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
  ['F59E0B', '3B82F6', '10B981', 'EF4444', '8B5CF6', 'EC4899']
    .map((hex, i) => `<a:accent${i + 1}><a:srgbClr val="${hex}"/></a:accent${i + 1}>`)
    .join('') +
  '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="OpenPoll">' +
  '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="OpenPoll">' +
  `<a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst>` +
  `<a:lnStyleLst>${`<a:ln w="9525">${solid}</a:ln>`.repeat(3)}</a:lnStyleLst>` +
  `<a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst>` +
  `<a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst>` +
  '</a:fmtScheme></a:themeElements></a:theme>';

function buildPptx(): Uint8Array {
  const [first, second] = SAMPLE_PPTX.slides;
  const parts: Record<string, string> = {
    '[Content_Types].xml':
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="${CT}.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/slides/slide2.xml" ContentType="${CT}.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}.theme+xml"/>` +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      `<Override PartName="/docProps/app.xml" ContentType="${CT}.extended-properties+xml"/>` +
      '</Types>',
    '_rels/.rels': rels([
      ['rId1', `${REL}/officeDocument`, 'ppt/presentation.xml'],
      ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'],
      ['rId3', `${REL}/extended-properties`, 'docProps/app.xml'],
    ]),
    'docProps/core.xml':
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${SAMPLE_PPTX.title}</dc:title>` +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created></cp:coreProperties>',
    'docProps/app.xml':
      `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
      '<Application>OpenPoll fixture</Application><Slides>2</Slides></Properties>',
    'ppt/presentation.xml':
      `${XML}<p:presentation ${NS} saveSubsetFonts="1">` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>' +
      '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([
      ['rId1', `${REL}/slideMaster`, 'slideMasters/slideMaster1.xml'],
      ['rId2', `${REL}/slide`, 'slides/slide1.xml'],
      ['rId3', `${REL}/slide`, 'slides/slide2.xml'],
      ['rId4', `${REL}/theme`, 'theme/theme1.xml'],
    ]),
    'ppt/slideMasters/slideMaster1.xml':
      `${XML}<p:sldMaster ${NS}><p:cSld><p:spTree>${emptyTree}</p:spTree></p:cSld>` +
      '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
      'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
      '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>',
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': rels([
      ['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml'],
      ['rId2', `${REL}/theme`, '../theme/theme1.xml'],
    ]),
    'ppt/slideLayouts/slideLayout1.xml':
      `${XML}<p:sldLayout ${NS} type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>${emptyTree}` +
      '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>',
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': rels([
      ['rId1', `${REL}/slideMaster`, '../slideMasters/slideMaster1.xml'],
    ]),
    'ppt/theme/theme1.xml': theme,
    // Deck order is slide2.xml then slide1.xml (see sldIdLst above).
    'ppt/slides/slide2.xml': slideXml(first!.title, first!.bullets),
    'ppt/slides/_rels/slide2.xml.rels': rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml']]),
    'ppt/slides/slide1.xml': slideXml(second!.title, second!.bullets),
    'ppt/slides/_rels/slide1.xml.rels': rels([['rId1', `${REL}/slideLayout`, '../slideLayouts/slideLayout1.xml']]),
  };

  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, [strToU8(xml), { mtime: FIXED_DATE }]])),
    { level: 6 },
  );
}

writeFileSync(join(dir, 'sample.pdf'), await buildPdf());
writeFileSync(join(dir, 'sample.pptx'), buildPptx());
console.log(`Wrote sample.pdf and sample.pptx to ${dir}`);
