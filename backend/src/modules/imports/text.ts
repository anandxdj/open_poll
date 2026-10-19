/**
 * Text helpers shared by every importer. Imported text ends up in slides that
 * are rendered as plain text (never HTML), so the job here is only to keep
 * it well formed: no control characters, bounded, single-spaced.
 */

/** C0 controls except tab, line feed and carriage return; DEL; the unicode line/paragraph separators. */
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u2028\\u2029\\ufeff]', 'g');

/** Control characters removed, line endings normalised to `\n`. */
export const stripControl = (value: string) => value.replace(/\r\n?/g, '\n').replace(CONTROL, '');

/** One line: whitespace runs collapsed, trimmed. */
export const oneLine = (value: string) => stripControl(value).replace(/\s+/g, ' ').trim();

/** At most `max` characters, ending in an ellipsis when cut (never splits a surrogate pair). */
export function truncate(value: string, max: number): { text: string; cut: boolean } {
  const chars = Array.from(value);
  if (chars.length <= max) return { text: value, cut: false };
  return { text: `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`, cut: true };
}

export const clip = (value: string, max: number) => truncate(value, max).text;
