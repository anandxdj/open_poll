import { redisClient } from '../../common/config/redis';
import { PresentationModel, PresentationParticipantModel } from './presentations.model';
import { QuizModel, QuizParticipantModel } from '../quizzes/quizzes.model';
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
                await computeSlideDistributionHelper(
                  'presentation',
                  pId,
                  presentation.currentSlideIndex,
                  slide,
                  PresentationParticipantModel
                );

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

      // Process active quizzes
      const quizIds = await redisClient
        .sMembers('buffer:active_quiz_distributions')
        .catch(() => [] as string[]);

      if (quizIds.length > 0) {
        await redisClient.del('buffer:active_quiz_distributions').catch(() => {});
        for (const qId of quizIds) {
          const quiz = await QuizModel.findById(qId);
          if (quiz && quiz.status === 'active' && quiz.currentSlideIndex >= 0) {
            const slide = quiz.slides[quiz.currentSlideIndex];
            if (slide && slide.type !== 'leaderboard') {
              const { distribution, answeredCount, participantCount } =
                await computeSlideDistributionHelper(
                  'quiz',
                  qId,
                  quiz.currentSlideIndex,
                  slide,
                  QuizParticipantModel
                );

              await publishPresentationEvent(qId, 'answer:received', {
                slideIndex: quiz.currentSlideIndex,
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
