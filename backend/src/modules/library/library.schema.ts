import { z } from 'zod';
import { LIBRARY_STATUSES } from './library.types';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id format');

/** Empty query values (`?q=`) mean "not set". */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const LIBRARY_DEFAULT_LIMIT = 24;
export const LIBRARY_MAX_LIMIT = 60;

/** `GET /api/library` query string. */
export const libraryQuerySchema = z.object({
  type: optional(z.enum(['all', 'poll', 'presentation'])).transform((value) => value ?? 'all'),
  status: optional(z.enum(LIBRARY_STATUSES)),
  /** A folder id, or `root` for items outside any folder. */
  folderId: optional(z.union([z.literal('root'), objectId])),
  /** Case-insensitive title substring. */
  q: optional(z.string().trim().max(100)),
  cursor: optional(z.string().max(200)),
  limit: optional(z.coerce.number().int().min(1).max(LIBRARY_MAX_LIMIT)).transform(
    (value) => value ?? LIBRARY_DEFAULT_LIMIT,
  ),
});

export type LibraryQuery = z.infer<typeof libraryQuerySchema>;

/** `POST /api/library/convert/poll/:pollId` query string. */
export const convertQuerySchema = z.object({
  force: optional(z.enum(['true', 'false', '1', '0'])).transform((value) => value === 'true' || value === '1'),
});
