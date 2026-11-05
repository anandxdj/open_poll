import { ApiError } from '../../common/utils/ApiError';

/**
 * Deck revisions for co-editing (W3-B2). `Presentation.revision` (in every deck
 * response body) counts the saves that changed the title or the slides. A
 * client that read revision N sends `If-Match: "N"` with its write; when
 * someone saved in between the write is refused with 409 `DECK_CHANGED`
 * instead of overwriting their edit. (It is not sent as an ETag: Express's own
 * body ETag keeps GET revalidation right when only the theme or settings change.)
 * Without `If-Match` writes behave as before (last write wins, MCP and older
 * clients), apart from the slide-level routes, which retry on a concurrent save.
 */

/** 409 DECK_CHANGED, with the deck's current revision when known (the caller may edit the deck). */
export const deckChanged = (revision?: number) =>
  new ApiError(
    409,
    'The deck changed since it was read: someone else saved it. Read it again and retry.',
    'DECK_CHANGED',
    revision === undefined ? undefined : { revision },
  );

const IF_MATCH = /^(?:W\/)?"?(\d{1,9})"?$/;

/**
 * The revision named by an `If-Match` header: `"12"`, `12` or `W/"12"`.
 * Absent, empty or `*` (any revision) → undefined, i.e. no check.
 * Anything else → 400 `INVALID_IF_MATCH`.
 */
export function parseIfMatch(header: string | undefined): number | undefined {
  if (header === undefined) return undefined;
  const value = header.trim();
  if (value === '' || value === '*') return undefined;
  const match = IF_MATCH.exec(value);
  if (!match) throw new ApiError(400, 'If-Match must be the deck revision, for example "12"', 'INVALID_IF_MATCH');
  return Number(match[1]);
}
