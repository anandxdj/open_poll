import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { contentOf, contentSlideSchema, optionalText, requiredText, textField, truncate } from './shared';

/** Link targets the markdown-lite renderer turns into links. */
const LINK_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/**
 * `[text](target)` in markdown-lite; the target may hold one level of balanced
 * parentheses. Same pattern as the frontend renderer (slides/content/markdown.tsx).
 */
const LINK_RE = /\[([^\]\n]*)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g;

const isAllowedLink = (target: string) => {
  try {
    return LINK_PROTOCOLS.has(new URL(target).protocol);
  } catch {
    return false;
  }
};

/** The first link target in `body` that is not an http(s)/mailto URL, if any. */
export const firstUnsafeLink = (body: string): string | null => {
  for (const match of body.matchAll(LINK_RE)) {
    if (!isAllowedLink(match[2]!)) return match[2]!;
  }
  return null;
};

const content = z.object({
  title: optionalText(150),
  /**
   * Markdown-lite: `**bold**`, `*italic*` / `_italic_` and `[text](https://…)`
   * links; blank lines separate paragraphs. Everything else is plain text.
   */
  body: requiredText(2000, 'Paragraph text is required').refine(
    (body) => firstUnsafeLink(body) === null,
    'Links must start with https://, http:// or mailto:'
  ),
});

/** A block of text with light formatting. */
export const paragraphSlide = defineSlideType<never, never>({
  type: 'paragraph',
  name: 'Paragraph',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('paragraph', content),
  sanitize: (slide) => {
    const c = contentOf(slide);
    return { content: { title: textField(c.title), body: textField(c.body) } };
  },
  label: (slide) => {
    const c = contentOf(slide);
    return textField(c.title) || truncate(textField(c.body)) || 'Paragraph';
  },
});

registerSlideType(paragraphSlide);
