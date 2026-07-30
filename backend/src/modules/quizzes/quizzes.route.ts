import { Router } from 'express';
import { QuizController } from './quizzes.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import {
  createQuizSchema,
  updateQuizSchema,
  joinQuizSchema,
  submitQuizAnswerSchema,
} from './quizzes.schema';
import { authenticate } from '../auth/auth.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';

const router = Router();

// Public participant flow (no auth — participants join with a nickname).
// Rate limits are per-IP and sized for classroom NAT (many players, one IP):
// they exist to stop bots/enumeration, not to throttle legit bursts.
router.get(
  '/code/:code',
  rateLimit({ prefix: 'quiz-code', windowSec: 60, max: 60 }),
  // Per-IP alone doesn't stop enumeration spread across many IPs — cap total
  // lookups system-wide too. 300k/hr is still far short of exhausting the
  // 900k code space before a live quiz session ends.
  rateLimit({ prefix: 'quiz-code-global', windowSec: 60, max: 5000, keyBy: 'global' }),
  QuizController.getByCode
);
router.post(
  '/:id/join',
  rateLimit({ prefix: 'quiz-join', windowSec: 300, max: 500 }),
  validate(joinQuizSchema),
  QuizController.join
);
router.post(
  '/:id/answer',
  rateLimit({ prefix: 'quiz-answer', windowSec: 60, max: 2000 }),
  validate(submitQuizAnswerSchema),
  QuizController.answer
);
router.get(
  '/:id/me',
  rateLimit({ prefix: 'quiz-me', windowSec: 60, max: 600 }),
  QuizController.participantState
);

// Creator CRUD
router.post('/', authenticate(), validate(createQuizSchema), QuizController.create);
router.get('/', authenticate(), QuizController.listByCreator);
router.get('/:id', authenticate(), QuizController.getById);
router.patch('/:id', authenticate(), validate(updateQuizSchema), QuizController.update);
router.delete('/:id', authenticate(), QuizController.delete);

// Host session controls
router.get('/:id/host/state', authenticate(), QuizController.hostState);
router.post('/:id/host/open-lobby', authenticate(), QuizController.openLobby);
router.post('/:id/host/next-question', authenticate(), QuizController.startNextQuestion);
router.post('/:id/host/reveal', authenticate(), QuizController.reveal);
router.post('/:id/host/leaderboard', authenticate(), QuizController.showLeaderboard);
router.post('/:id/host/end', authenticate(), QuizController.end);

export default router;
