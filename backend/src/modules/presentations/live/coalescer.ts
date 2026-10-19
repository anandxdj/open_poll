import { redisClient } from '../../../common/config/redis';
import { liveEventsCoalesced } from '../../../common/observability/metrics';
import { timeRedis } from '../../../common/observability/redisTiming';
import { PresentationSessionModel } from '../models/session.model';
import { DIRTY_WINDOW_MS } from './answerScript';
import { computeSlideDistributionHelper } from './distribution';
import { publishAnswerReceived } from './events';
import { k } from './keys';
import { sessionSlides, slideIdOf, type Slide } from './state';

/**
 * Host live updates, coalesced. The answer script marks the slide dirty
 * (`:dirty:slides`) and tries `SET :dirty NX PX 250`; the one answer that wins
 * that SET owns the 250 ms window and calls `scheduleDirtyFlush`. When the
 * window ends its instance drains the dirty set and publishes ONE host-only
 * `answer:received` (answered count + distribution) per dirty slide — however
 * many answers arrived and on whichever instances.
 *
 * Exactly once: the window flag is a single Redis key, so one instance owns
 * each window; the drain (`SMEMBERS` + `DEL` in one transaction) hands every
 * dirty slide to exactly one flush even when a late flush overlaps the next
 * window's. If the owning instance dies mid-window, the set simply waits for
 * the next answer's window.
 */

export { DIRTY_WINDOW_MS };

/** Decks never change under a session (the snapshot is frozen at open), so slides are cached. */
const SLIDE_CACHE_TTL_MS = 60_000;
const SLIDE_CACHE_MAX = 200;
const slideCache = new Map<string, { slides: Slide[]; expires: number }>();

const slidesOf = async (sessionId: string): Promise<Slide[]> => {
  const cached = slideCache.get(sessionId);
  if (cached && cached.expires > Date.now()) return cached.slides;
  const session = await PresentationSessionModel.findById(sessionId).select('deckSnapshot').lean();
  if (!session) return [];
  const slides = sessionSlides(session as never);
  if (slideCache.size >= SLIDE_CACHE_MAX) slideCache.delete(slideCache.keys().next().value!);
  slideCache.set(sessionId, { slides, expires: Date.now() + SLIDE_CACHE_TTL_MS });
  return slides;
};

/** Takes (and clears) the slides answered since the last flush. */
const takeDirtySlides = async (sessionId: string): Promise<string[]> => {
  const key = k.dirtySlides(sessionId);
  const replies = await redisClient.multi().sMembers(key).del(key).exec();
  return (replies[0] as unknown as string[]) ?? [];
};

/**
 * Publishes the host update for every slide answered since the last flush.
 * Resolves to how many `answer:received` events it published.
 */
export const flushDirty = async (presentationId: string, sessionId: string): Promise<number> => {
  let slideIds: string[];
  try {
    slideIds = await timeRedis('coalescer_take', () => takeDirtySlides(sessionId));
  } catch (error) {
    console.error('[Presentation] Coalescer could not read the dirty set:', error);
    return 0;
  }
  if (slideIds.length === 0) return 0;

  const slides = await slidesOf(sessionId).catch(() => [] as Slide[]);
  let published = 0;
  for (const slideId of slideIds) {
    const slideIndex = slides.findIndex((slide) => slideIdOf(slide) === slideId);
    if (slideIndex < 0) continue;
    try {
      const { distribution, answeredCount, participantCount } = await computeSlideDistributionHelper(
        sessionId,
        slideId,
        slides[slideIndex]
      );
      await publishAnswerReceived(presentationId, sessionId, {
        slideId,
        slideIndex,
        answeredCount,
        participantCount,
        distribution,
      });
      liveEventsCoalesced.inc();
      published += 1;
    } catch (error) {
      console.error('[Presentation] Coalesced answer update failed:', error);
    }
  }
  return published;
};

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

interface PendingFlush {
  presentationId: string;
  sessionId: string;
}
const pending = new Map<ReturnType<typeof setTimeout>, PendingFlush>();

/** Called by the answer that opened a window: flush when it ends. */
export const scheduleDirtyFlush = (presentationId: string, sessionId: string) => {
  const timer = setTimeout(() => {
    pending.delete(timer);
    void flushDirty(presentationId, sessionId);
  }, DIRTY_WINDOW_MS);
  timer.unref?.();
  pending.set(timer, { presentationId, sessionId });
};

/** Runs every scheduled flush now (tests, graceful shutdown). Resolves to the events published. */
export const flushScheduledNow = async (): Promise<number> => {
  const due = [...pending];
  pending.clear();
  let published = 0;
  for (const [timer, flush] of due) {
    clearTimeout(timer);
    published += await flushDirty(flush.presentationId, flush.sessionId);
  }
  return published;
};

export const resetCoalescerCache = () => slideCache.clear();
