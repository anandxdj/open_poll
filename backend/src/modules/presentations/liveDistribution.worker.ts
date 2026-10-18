import { redisClient } from '../../common/config/redis';
import { PresentationModel } from './models/presentation.model';
import { getSlideType } from './slides';
import { ACTIVE_DISTRIBUTIONS_KEY } from './live/keys';
import { computeSlideDistributionHelper } from './live/distribution';
import { publishAnswerReceived } from './live/events';

const WORKER_INTERVAL_MS = 2000;

/**
 * Drains the set of decks with fresh answers and publishes each one's current
 * distribution to the host (`answer:received` is host-only). Only slides whose
 * registry lifecycle is `response` have a distribution to push.
 */
export const runLiveDistributionTick = async () => {
  const presentationIds = await redisClient.sMembers(ACTIVE_DISTRIBUTIONS_KEY).catch(() => [] as string[]);
  if (presentationIds.length === 0) return;

  await redisClient.del(ACTIVE_DISTRIBUTIONS_KEY).catch(() => {});
  for (const presentationId of presentationIds) {
    const presentation = await PresentationModel.findById(presentationId);
    if (!presentation || presentation.status !== 'active' || presentation.currentSlideIndex < 0) continue;

    const slide = presentation.slides[presentation.currentSlideIndex];
    if (!slide || getSlideType(slide.type)?.lifecycle !== 'response') continue;

    const { distribution, answeredCount, participantCount } = await computeSlideDistributionHelper(
      presentationId,
      presentation.currentSlideIndex,
      slide
    );
    await publishAnswerReceived(presentationId, {
      slideIndex: presentation.currentSlideIndex,
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
