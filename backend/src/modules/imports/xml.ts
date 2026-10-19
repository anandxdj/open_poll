import { strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { ImportError } from './errors';

/**
 * Untrusted OOXML parts → a small element tree in document order.
 *
 * Entity processing is off in the parser (no DOCTYPE entities, so no
 * billion-laughs expansion), and any part declaring a DOCTYPE is refused:
 * OOXML never uses one. The five predefined entities and numeric character
 * references are decoded here, in text and attribute values.
 */

export interface XmlElement {
  /** Qualified tag name as written, e.g. `p:sp`. */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const ATTRS = ':@';
const TEXT = '#text';

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  htmlEntities: false,
  trimValues: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 256,
});

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decodes the predefined XML entities and numeric references; anything else stays literal. */
export function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return NAMED[body] ?? match;
  });
}

type RawNode = Record<string, unknown>;

function convert(raw: RawNode[]): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of raw) {
    for (const key of Object.keys(node)) {
      if (key === ATTRS) continue;
      if (key === TEXT) {
        out.push(decodeEntities(String(node[TEXT] ?? '')));
        continue;
      }
      const attrsRaw = (node[ATTRS] ?? {}) as Record<string, unknown>;
      const attrs: Record<string, string> = {};
      for (const [name, value] of Object.entries(attrsRaw)) attrs[name] = decodeEntities(String(value));
      out.push({ name: key, attrs, children: convert((node[key] ?? []) as RawNode[]) });
    }
  }
  return out;
}

/** Parses one XML part; `invalid` builds the error for a malformed or hostile part. */
export function parseXml(input: Uint8Array | string, invalid: () => ImportError): XmlElement {
  const text = typeof input === 'string' ? input : strFromU8(input);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw invalid();
  let raw: RawNode[];
  try {
    raw = parser.parse(text) as RawNode[];
  } catch {
    throw invalid();
  }
  const root = convert(raw).find((node): node is XmlElement => typeof node !== 'string');
  if (!root) throw invalid();
  return root;
}

// ---------- Navigation ----------

export const isElement = (node: XmlNode | undefined | null): node is XmlElement =>
  node != null && typeof node !== 'string';

/** Local name without the namespace prefix (`p:sp` → `sp`). */
export const localName = (name: string) => name.slice(name.indexOf(':') + 1);

export const elements = (node: XmlElement | null | undefined): XmlElement[] =>
  node ? node.children.filter(isElement) : [];

/** Direct children with this qualified name. */
export const childrenNamed = (node: XmlElement | null | undefined, name: string): XmlElement[] =>
  elements(node).filter((child) => child.name === name);

/** First direct child with this qualified name. */
export const child = (node: XmlElement | null | undefined, name: string): XmlElement | null =>
  elements(node).find((c) => c.name === name) ?? null;

/** Follows a path of qualified names through first children. */
export const path = (node: XmlElement | null | undefined, ...names: string[]): XmlElement | null => {
  let current: XmlElement | null = node ?? null;
  for (const name of names) current = child(current, name);
  return current;
};

/** Every descendant (depth-first, document order) with this qualified name. */
export function descendants(node: XmlElement | null | undefined, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (current: XmlElement) => {
    for (const c of elements(current)) {
      if (c.name === name) found.push(c);
      walk(c);
    }
  };
  if (node) walk(node);
  return found;
}

/** Concatenated text content of the node's direct text children. */
export const ownText = (node: XmlElement | null | undefined): string =>
  node ? node.children.filter((c): c is string => typeof c === 'string').join('') : '';
