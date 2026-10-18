import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { SAMPLE_PPTX } from '../fixtures/import/constants';

/**
 * W3-E spike: fflate unzips a .pptx and fast-xml-parser reads PresentationML
 * under Bun. Deck order comes from presentation.xml `sldIdLst` resolved
 * through the relationships, never from part names.
 */
const ARRAYS = new Set(['p:sldId', 'Relationship', 'p:sp', 'a:p', 'a:r']);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  isArray: (name) => ARRAYS.has(name),
});

type Xml = Record<string, any>;

function readDeck(file: Uint8Array) {
  const parts = unzipSync(file);
  const xml = (path: string): Xml => {
    const part = parts[path];
    if (!part) throw new Error(`Missing part ${path}`);
    return parser.parse(strFromU8(part));
  };
  const relsOf = (path: string) => {
    const relsPath = posix.join(posix.dirname(path), '_rels', `${posix.basename(path)}.rels`);
    const targets = new Map<string, string>();
    for (const rel of xml(relsPath).Relationships.Relationship as Xml[]) {
      targets.set(rel.Id, posix.join(posix.dirname(path), rel.Target));
    }
    return targets;
  };

  const presentationPath = 'ppt/presentation.xml';
  const targets = relsOf(presentationPath);
  const slideIds = xml(presentationPath)['p:presentation']['p:sldIdLst']['p:sldId'] as Xml[];

  return slideIds.map(({ 'r:id': rId }) => {
    const path = targets.get(rId)!;
    const shapes = (xml(path)['p:sld']['p:cSld']['p:spTree']['p:sp'] ?? []) as Xml[];
    const paragraphsOf = (shape: Xml) =>
      ((shape['p:txBody']?.['a:p'] ?? []) as Xml[]).map((p) => ({
        text: ((p['a:r'] ?? []) as Xml[]).map((r) => r['a:t']).join(''),
        level: Number(p['a:pPr']?.lvl ?? 0),
      }));
    const placeholder = (shape: Xml) => shape['p:nvSpPr']['p:nvPr']['p:ph'] as Xml | undefined;
    const title = shapes.find((s) => placeholder(s)?.type === 'title');
    const body = shapes.find((s) => placeholder(s) && placeholder(s)?.type !== 'title');
    return {
      part: path,
      title: title ? paragraphsOf(title).map((p) => p.text).join(' ') : '',
      bullets: body ? paragraphsOf(body) : [],
    };
  });
}

describe('spike: fflate + fast-xml-parser', () => {
  it('reads the fixture deck in sldIdLst order with nested bullet levels', () => {
    const deck = readDeck(new Uint8Array(readFileSync(`${import.meta.dir}/../fixtures/import/sample.pptx`)));
    expect(deck.map((slide) => slide.part)).toEqual(['ppt/slides/slide2.xml', 'ppt/slides/slide1.xml']);
    expect(deck.map(({ title, bullets }) => ({ title, bullets }))).toEqual(
      SAMPLE_PPTX.slides.map(({ title, bullets }) => ({ title, bullets: [...bullets] })),
    );
  });
});
