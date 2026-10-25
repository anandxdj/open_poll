import { redisClient } from '../../../common/config/redis';
import { timeRedis } from '../../../common/observability/redisTiming';
import { k } from './keys';

/**
 * Auto-reveal schedule (W2-D). A scored, timed response slide reveals itself
 * this long after its timer runs out; until then answers that carry a valid
 * slide ticket are still accepted (`answer.lua`), so a phone that lost its
 * connection for a moment does not lose the round.
 *
 * The schedule is one global ZSET (`live:autoreveal`, member `sid|slideId`,
 * score = due time in ms), kept in step with every answer-window write
 * (`cacheAnswerWindow`). Every instance polls it; `ZREM` decides which one
 * reveals, so each slide auto-reveals exactly once across the cluster.
 */
export const AUTO_REVEAL_DELAY_MS = 1500;

/** Only the fields of an answer window the schedule depends on. */
export interface AutoRevealWindow {
  slideId: string;
  open: boolean;
  scored: boolean;
  endsAtMs: number | null;
  pausedRemainingMs: number | null;
}

const member = (sessionId: string, slideId: string) => `${sessionId}|${slideId}`;

/** True when the window should auto-reveal: open, scored, timed and not paused. */
export const autoRevealDueAt = (window: AutoRevealWindow): number | null =>
  window.open && window.scored && window.endsAtMs !== null && window.pausedRemainingMs === null
    ? window.endsAtMs + AUTO_REVEAL_DELAY_MS
    : null;

/** Schedules (or re-times, or cancels) the auto-reveal of one window. Never throws. */
export const syncAutoReveal = async (sessionId: string, window: AutoRevealWindow) => {
  const dueAt = autoRevealDueAt(window);
  try {
    if (dueAt === null) await redisClient.zRem(k.autoReveal(), member(sessionId, window.slideId));
    else await redisClient.zAdd(k.autoReveal(), { score: dueAt, value: member(sessionId, window.slideId) });
  } catch (error) {
    console.error('[Presentation] Failed to update the auto-reveal schedule:', error);
  }
};

/** Puts a claimed entry back (the reveal could not run now). */
export const rescheduleAutoReveal = async (sessionId: string, slideId: string, dueAt: number) => {
  await redisClient
    .zAdd(k.autoReveal(), { score: dueAt, value: member(sessionId, slideId) })
    .catch((error) => console.error('[Presentation] Failed to reschedule an auto-reveal:', error));
};

/**
 * Claims the entries due by `now`. A claim is a successful `ZREM`, so two
 * instances polling at once never both get the same slide.
 */
export const claimDueAutoReveals = async (
  now = Date.now(),
  limit = 25
): Promise<{ sessionId: string; slideId: string; dueAt: number }[]> => {
  const due = await timeRedis('autoreveal_poll', () =>
    redisClient.zRangeByScoreWithScores(k.autoReveal(), '-inf', now, { LIMIT: { offset: 0, count: limit } })
  );
  const claimed: { sessionId: string; slideId: string; dueAt: number }[] = [];
  for (const entry of due) {
    if ((await redisClient.zRem(k.autoReveal(), entry.value)) !== 1) continue;
    const [sessionId, slideId] = entry.value.split('|');
    if (sessionId && slideId) claimed.push({ sessionId, slideId, dueAt: entry.score });
  }
  return claimed;
};
