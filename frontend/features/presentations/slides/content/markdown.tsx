import { Fragment, type ReactNode } from "react";

// Markdown-lite for paragraph slides: `**bold**`, `*italic*` / `_italic_`,
// `[text](https://…)` links, `\` escapes, blank lines between paragraphs and
// single newlines as line breaks. Nothing else is markup: the output is
// React elements with text children, so HTML in the source shows up as text
// and never reaches the DOM as markup. Links only for http(s) and mailto.

export type MdInline =
  | { type: "text"; text: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "link"; href: string; children: MdInline[] };

/** Paragraphs → lines → inline nodes. */
export type MdDocument = MdInline[][][];

const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const ESCAPABLE = new Set(["\\", "*", "_", "[", "]", "(", ")"]);
/** `[text](target)`; the target may hold one level of balanced parentheses (Wikipedia-style URLs). */
const LINK_SOURCE = String.raw`\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)`;
const LINK_RE = new RegExp(`^${LINK_SOURCE}`);
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

/** `target` as a link href when it is an absolute http(s)/mailto URL, else null. */
export function safeHref(target: string): string | null {
  try {
    const url = new URL(target);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** True when a `[text](target)` in `source` has a target `safeHref` refuses (the API rejects those). */
export const hasUnsafeLink = (source: string) =>
  [...source.matchAll(new RegExp(LINK_SOURCE, "g"))].some((match) => safeHref(match[2]!) === null);

const isWordChar = (ch: string | undefined) => ch !== undefined && WORD_CHAR.test(ch);

/**
 * Index of the delimiter closing an emphasis opened just before `from`, or -1.
 * The content may not start or end with whitespace; escaped delimiters are
 * skipped; a single `*` steps over nested `**` pairs; `_` must close at a
 * word boundary (so snake_case stays text).
 */
function findClose(src: string, from: number, delim: "**" | "*" | "_"): number {
  if (from >= src.length || SPACE.test(src[from]!)) return -1;
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") {
      j += 1;
      continue;
    }
    if (delim === "*" && src.startsWith("**", j)) {
      const nested = findClose(src, j + 2, "**");
      if (nested > 0) {
        j = nested + 1;
        continue;
      }
    }
    if (!src.startsWith(delim, j) || j === from || SPACE.test(src[j - 1]!)) continue;
    if (delim === "_" && isWordChar(src[j + 1])) continue;
    return j;
  }
  return -1;
}

export function parseInline(src: string): MdInline[] {
  const nodes: MdInline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) nodes.push({ type: "text", text: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    if (ch === "\\" && ESCAPABLE.has(src[i + 1] ?? "")) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === "[") {
      const link = LINK_RE.exec(src.slice(i));
      if (link) {
        flush();
        const children = parseInline(link[1]!);
        const href = safeHref(link[2]!);
        // An unsafe target keeps only its label, as plain text.
        if (href) nodes.push({ type: "link", href, children });
        else nodes.push(...children);
        i += link[0].length;
        continue;
      }
    }

    if (ch === "*" && src[i + 1] === "*") {
      const close = findClose(src, i + 2, "**");
      if (close > 0) {
        flush();
        nodes.push({ type: "strong", children: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (ch === "*" || (ch === "_" && !isWordChar(src[i - 1]))) {
      const close = findClose(src, i + 1, ch);
      if (close > 0) {
        flush();
        nodes.push({ type: "em", children: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return nodes;
}

export function parseMarkdownLite(source: string): MdDocument {
  return source
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => paragraph.split("\n").map((line) => parseInline(line.trim())));
}

export interface MarkdownLiteClasses {
  paragraph?: string;
  strong?: string;
  em?: string;
  link?: string;
}

function renderInline(nodes: MdInline[], classes: MarkdownLiteClasses, linkable: boolean): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>;
      case "strong":
        return (
          <strong key={i} className={classes.strong}>
            {renderInline(node.children, classes, linkable)}
          </strong>
        );
      case "em":
        return (
          <em key={i} className={classes.em}>
            {renderInline(node.children, classes, linkable)}
          </em>
        );
      case "link":
        return linkable ? (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className={classes.link}>
            {renderInline(node.children, classes, linkable)}
          </a>
        ) : (
          <span key={i} className={classes.link}>
            {renderInline(node.children, classes, linkable)}
          </span>
        );
    }
  });
}

/**
 * Renders markdown-lite `text`. `linkable={false}` draws links as styled text
 * (thumbnails and other inert previews).
 */
export function MarkdownLite({
  text,
  className,
  classes = {},
  linkable = true,
}: {
  text: string;
  className?: string;
  classes?: MarkdownLiteClasses;
  linkable?: boolean;
}) {
  return (
    <div className={className}>
      {parseMarkdownLite(text).map((lines, p) => (
        <p key={p} className={classes.paragraph}>
          {lines.map((line, l) => (
            <Fragment key={l}>
              {l > 0 && <br />}
              {renderInline(line, classes, linkable)}
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}
