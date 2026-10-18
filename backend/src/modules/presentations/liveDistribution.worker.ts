import { redisClient } from '../../common/config/redis';
import { PresentationModel } from './presentations.model';
import { computeSlideDistributionHelper, publishPresentationEvent } from './presentations.service';

const WORKER_INTERVAL_MS = 2000;

export const startLiveDistributionWorker = () => {
  setInterval(async () => {
    try {
      // Process active presentations
      const presentationIds = await redisClient
        .sMembers('buffer:active_presentation_distributions')
        .catch(() => [] as string[]);

      if (presentationIds.length > 0) {
        await redisClient.del('buffer:active_presentation_distributions').catch(() => {});
        for (const pId of presentationIds) {
          const presentation = await PresentationModel.findById(pId);
          if (
            presentation &&
            presentation.status === 'active' &&
            presentation.currentSlideIndex >= 0
          ) {
            const slide = presentation.slides[presentation.currentSlideIndex];
            if (slide && slide.type !== 'leaderboard') {
              const { distribution, answeredCount, participantCount } =
                await computeSlideDistributionHelper(pId, presentation.currentSlideIndex, slide);

              await publishPresentationEvent(pId, 'answer:received', {
                slideIndex: presentation.currentSlideIndex,
                answeredCount,
                participantCount,
                distribution,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('[Live Distribution Worker Error]', error);
    }
  }, WORKER_INTERVAL_MS);
};
