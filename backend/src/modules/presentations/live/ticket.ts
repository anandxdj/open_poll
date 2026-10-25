import { hexEquals, scopedHmac } from '../../../common/utils/signedId.utils';

/**
 * Slide tickets (W2-D). A ticket is the server's HMAC over one answer window —
 * `(sessionId, slideId, startedAtMs)` — handed to clients only while that
 * window is open (`question:started`, participant `live-state` / `live:resync`).
 * Presenting it with an answer proves the client saw the question while it
 * was open, which lets the answer path accept it a little late (see
 * `answer.lua`): unscored slides until the window end + 15 s, scored slides
 * until their reveal (capped at the same 15 s). It is per window, not per
 * participant: who answers is proven by the participant token, as always.
 * A reopened slide has a new `startedAtMs`, so its old tickets stop working.
 *
 * Format: `st1.<32 hex>` (128-bit truncated HMAC-SHA256, keyed by
 * ID_SIGNING_SECRET through `scopedHmac`).
 */
const TICKET_SCOPE = 'slide-ticket.v1';
const PREFIX = 'st1.';

const signature = (sessionId: string, slideId: string, startedAtMs: number) =>
  scopedHmac(TICKET_SCOPE, `${sessionId}|${slideId}|${startedAtMs}`).slice(0, 32);

export const issueSlideTicket = (sessionId: string, slideId: string, startedAtMs: number) =>
  `${PREFIX}${signature(sessionId, slideId, startedAtMs)}`;

/** True when `ticket` was issued for exactly this answer window. Constant time. */
export const verifySlideTicket = (
  ticket: unknown,
  sessionId: string,
  slideId: string,
  startedAtMs: number
): boolean => {
  if (typeof ticket !== 'string' || !ticket.startsWith(PREFIX) || ticket.length !== PREFIX.length + 32) return false;
  return hexEquals(ticket.slice(PREFIX.length), signature(sessionId, slideId, startedAtMs));
};
