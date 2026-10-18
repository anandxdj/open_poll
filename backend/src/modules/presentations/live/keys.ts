import { redisClient } from '../../../common/config/redis';
import type { SlideRedisTarget } from '../slides';

// Live-session Redis keys self-clean 6h after the last transition
export const PRESENTATION_KEY_TTL_SEC = 6 * 3600;

/** Decks with fresh answers, drained by the live distribution worker. */
export const ACTIVE_DISTRIBUTIONS_KEY = 'buffer:active_presentation_distributions';

// ---------------------------------------------------------------------------
// Redis key map — the answer hot path runs entirely on these (no Mongo reads),
// so hundreds of simultaneous clicks don't queue on the database. Mongo stays
// the durable system of record via async write-behind.
// ---------------------------------------------------------------------------
export const k = {
  session: (q: string) => `presentation:${q}:session`, // STRING JSON answer window (see AnswerWindow)
  scores: (q: string) => `presentation:${q}:scores`, // ZSET participantId -> total score
  correct: (q: string) => `presentation:${q}:correct`, // HASH participantId -> correct count
  names: (q: string) => `presentation:${q}:names`, // HASH participantId -> nickname
  tokens: (q: string) => `presentation:${q}:tokens`, // HASH participantId -> secret token
  answered: (q: string, i: number) => `presentation:${q}:answered:${i}`, // SET participantIds
  dist: (q: string, i: number) => `presentation:${q}:dist:${i}`, // HASH option/text -> count (sum/points for scales/ranking)
  disp: (q: string, i: number) => `presentation:${q}:disp:${i}`, // HASH normalized text -> first-seen original casing
  feed: (q: string, i: number) => `presentation:${q}:feed:${i}`, // LIST newest-first raw entries (lpush_trim ops)
  results: (q: string, i: number) => `presentation:${q}:results:${i}`, // HASH pid -> {isCorrect,score,scored}
};

/** Maps a slide type's logical Redis target to the key for one slide. */
export const slideKey = (presentationId: string, slideIndex: number, target: SlideRedisTarget) =>
  k[target](presentationId, slideIndex);

/** Per-slide keys an answer touches, refreshed together. */
export const slideKeys = (presentationId: string, slideIndex: number) => [
  k.answered(presentationId, slideIndex),
  k.dist(presentationId, slideIndex),
  k.disp(presentationId, slideIndex),
  k.feed(presentationId, slideIndex),
  k.results(presentationId, slideIndex),
];

export const allPresentationKeys = (presentationId: string, slideCount: number) => {
  const keys = [
    k.session(presentationId),
    k.scores(presentationId),
    k.correct(presentationId),
    k.names(presentationId),
    k.tokens(presentationId),
  ];
  for (let i = 0; i < slideCount; i++) keys.push(...slideKeys(presentationId, i));
  return keys;
};

export const touchTtls = async (keys: string[]) => {
  try {
    await Promise.all(keys.map((key) => redisClient.expire(key, PRESENTATION_KEY_TTL_SEC)));
  } catch (error) {
    console.error('[Presentation] Failed to refresh key TTLs:', error);
  }
};
