import { redisClient } from '../../../common/config/redis';
import type { SlideRedisTarget } from '../slides';

// Live-session Redis keys self-clean 6h after the last transition
export const SESSION_KEY_TTL_SEC = 6 * 3600;

/** Decks with fresh answers, drained by the live distribution worker. */
export const ACTIVE_DISTRIBUTIONS_KEY = 'buffer:active_presentation_distributions';

// ---------------------------------------------------------------------------
// Redis key map — the answer hot path runs entirely on these (no Mongo reads),
// so hundreds of simultaneous clicks don't queue on the database. Mongo stays
// the durable system of record via async write-behind.
//
// Session keys share the hash tag `{<sessionId>}`, so one session's keys live
// in one Cluster slot and a Lua script may touch any of them.
// ---------------------------------------------------------------------------
const session = (sid: string) => `psess:{${sid}}`;

export const k = {
  /** STRING: id of the deck's live session. */
  active: (presentationId: string) => `presentation:${presentationId}:active`,
  /** HASH: presentationId, pace, status, cap ('' = unlimited), runNumber, totalSlides. */
  meta: (sid: string) => `${session(sid)}:meta`,
  /** STRING: current slideId (presenter pace). */
  current: (sid: string) => `${session(sid)}:current`,
  /** HASH: slideId → answer window JSON (see `AnswerWindow`). */
  slides: (sid: string) => `${session(sid)}:slides`,
  scores: (sid: string) => `${session(sid)}:scores`, // ZSET participantId -> total score
  correct: (sid: string) => `${session(sid)}:correct`, // HASH participantId -> correct count
  names: (sid: string) => `${session(sid)}:names`, // HASH participantId -> nickname
  tokens: (sid: string) => `${session(sid)}:tokens`, // HASH participantId -> secret token
  seats: (sid: string) => `${session(sid)}:seats`, // SET deviceIds holding a seat (audience cap)
  kicked: (sid: string) => `${session(sid)}:kicked`, // SET participantIds removed by the host
  answered: (sid: string, slideId: string) => `${session(sid)}:answered:${slideId}`, // SET participantIds
  dist: (sid: string, slideId: string) => `${session(sid)}:dist:${slideId}`, // HASH option/text -> count (sum/points for scales/ranking)
  disp: (sid: string, slideId: string) => `${session(sid)}:disp:${slideId}`, // HASH normalized text -> first-seen original casing
  feed: (sid: string, slideId: string) => `${session(sid)}:feed:${slideId}`, // LIST newest-first raw entries (lpush_trim ops)
  results: (sid: string, slideId: string) => `${session(sid)}:results:${slideId}`, // HASH pid -> full answer JSON (StoredAnswerResult)
};

/** Maps a slide type's logical Redis target to the key for one slide. */
export const slideKey = (sid: string, slideId: string, target: SlideRedisTarget) => k[target](sid, slideId);

/** Per-slide keys an answer touches, refreshed together. */
export const slideKeys = (sid: string, slideId: string) => [
  k.answered(sid, slideId),
  k.dist(sid, slideId),
  k.disp(sid, slideId),
  k.feed(sid, slideId),
  k.results(sid, slideId),
];

/** Session-wide keys (not per slide). */
export const sessionWideKeys = (sid: string) => [
  k.meta(sid),
  k.current(sid),
  k.slides(sid),
  k.scores(sid),
  k.correct(sid),
  k.names(sid),
  k.tokens(sid),
  k.seats(sid),
  k.kicked(sid),
];

/** Every key of one session, given its slide ids. */
export const allSessionKeys = (sid: string, slideIds: string[]) => [
  ...sessionWideKeys(sid),
  ...slideIds.flatMap((slideId) => slideKeys(sid, slideId)),
];

export const touchTtls = async (keys: string[]) => {
  try {
    await Promise.all(keys.map((key) => redisClient.expire(key, SESSION_KEY_TTL_SEC)));
  } catch (error) {
    console.error('[Presentation] Failed to refresh key TTLs:', error);
  }
};
