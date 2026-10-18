import { z } from 'zod';
import { commonSlideShape } from '../../fields';
import type { Slide } from '../../types';

/**
 * Shared pieces of the content slide types (`kind: 'content'`,
 * `lifecycle: 'content'`): shown on the stage, no answer window, never scored.
 * Their payload lives in `slide.content`, validated by the type's schema and
 * sent to participants through an explicit allow-list (`sanitize`).
 *
 * Text is stored as typed and always rendered as text, never as HTML, so
 * markup in a title is shown literally instead of being rejected.
 */

/** Content slides never run a timer: whatever the client sends, the stored value is 0. */
const untimed = z
  .number()
  .int()
  .min(0)
  .max(300)
  .default(0)
  .transform(() => 0);

/** Request schema of one content slide type: the common fields plus its `content` payload. */
export const contentSlideSchema = <T extends string, C extends z.ZodType>(type: T, content: C) =>
  z.object({
    type: z.literal(type),
    ...commonSlideShape,
    timeLimit: untimed,
    content,
  });

/** Required single-line text. */
export const requiredText = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/** Optional text, stored as `''` when absent. */
export const optionalText = (max: number) => z.string().trim().max(max).default('');

// ---------- Reading stored payloads ----------

/**
 * The stored payload as a plain record. Stored content was validated on save,
 * but `content` is a Mixed field, so every read stays defensive.
 */
export const contentOf = (slide: Slide): Record<string, unknown> => {
  const content = slide.content;
  return content && typeof content === 'object' && !Array.isArray(content)
    ? (content as Record<string, unknown>)
    : {};
};

export const textField = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

export const boolField = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export const numberField = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** First `max` characters of a one-line summary, with an ellipsis when cut. */
export const truncate = (value: string, max = 80) => {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
