import { redisClient } from '../../common/config/redis';
import { ACTIVE_DISTRIBUTIONS_KEY } from './live/keys';
import { computeSlideDistributionHelper } from './live/distribution';
import { publishAnswerReceived } from './live/events';
import { findLiveSession, lifecycleOf, sessionSlides, slideIdOf } from './live/state';

const WORKER_INTERVAL_MS = 2000;

/**
 * Drains the set of decks with fresh answers and publishes the current slide's
 * distribution of each deck's live session to the host (`answer:received` is
 * host-only). Only slides whose registry lifecycle is `response` have one.
 */
export const runLiveDistributionTick = async () => {
  const presentationIds = await redisClient.sMembers(ACTIVE_DISTRIBUTIONS_KEY).catch(() => [] as string[]);
  if (presentationIds.length === 0) return;

  await redisClient.del(ACTIVE_DISTRIBUTIONS_KEY).catch(() => {});
  for (const presentationId of presentationIds) {
    const session = await findLiveSession(presentationId);
    if (!session || session.status !== 'active' || session.currentSlideIndex < 0) continue;

    const slide = sessionSlides(session)[session.currentSlideIndex];
    if (!slide || lifecycleOf(slide.type) !== 'response') continue;

    const sessionId = String(session._id);
    const slideId = slideIdOf(slide);
    const { distribution, answeredCount, participantCount } = await computeSlideDistributionHelper(
      sessionId,
      slideId,
      slide
    );
    await publishAnswerReceived(presentationId, sessionId, {
      slideId,
      slideIndex: session.currentSlideIndex,
      answeredCount,
      participantCount,
      distribution,
    });
  }
};

export const startLiveDistributionWorker = () => {
  setInterval(async () => {
    try {
      await runLiveDistributionTick();
    } catch (error) {
      console.error('[Live Distribution Worker Error]', error);
    }
  }, WORKER_INTERVAL_MS);
};
