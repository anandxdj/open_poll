import { claimDueAutoReveals, rescheduleAutoReveal } from './autoReveal';
import { autoRevealSlide } from './session.service';

const POLL_INTERVAL_MS = 250;
const RETRY_DELAY_MS = 500;
const ERROR_RETRY_DELAY_MS = 2000;

/**
 * Reveals every scored timed slide whose timer plus the auto-reveal delay has
 * passed. Each instance runs this; `claimDueAutoReveals` (a successful `ZREM`)
 * lets exactly one of them take a given slide. Returns how many it revealed.
 */
export const runAutoRevealTick = async (now = Date.now()): Promise<number> => {
  let revealed = 0;
  for (const { sessionId, slideId } of await claimDueAutoReveals(now)) {
    try {
      const outcome = await autoRevealSlide(sessionId, slideId);
      if (outcome === 'revealed') revealed += 1;
      if (outcome === 'retry') await rescheduleAutoReveal(sessionId, slideId, now + RETRY_DELAY_MS);
    } catch (error) {
      console.error('[Presentation] Auto-reveal failed, will retry:', error);
      await rescheduleAutoReveal(sessionId, slideId, now + ERROR_RETRY_DELAY_MS);
    }
  }
  return revealed;
};

export const startAutoRevealWorker = () => {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runAutoRevealTick();
    } catch (error) {
      console.error('[Auto-reveal Worker Error]', error);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};
