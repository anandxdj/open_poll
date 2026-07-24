import { Router } from 'express';
import { PresentationController } from './presentations.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import {
  createPresentationSchema,
  updatePresentationSchema,
  joinPresentationSchema,
  submitPresentationAnswerSchema,
} from './presentations.schema';
import { authenticate } from '../auth/auth.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';

const router = Router();

// Public participant flow (no auth — participants join with a nickname).
// Rate limits are per-IP and sized for classroom NAT (many players, one IP):
// they exist to stop bots/enumeration, not to throttle legit bursts.
router.get(
  '/code/:code',
  rateLimit({ prefix: 'presentation-code', windowSec: 60, max: 60 }),
  PresentationController.getByCode
);
router.post(
  '/:id/join',
  rateLimit({ prefix: 'presentation-join', windowSec: 300, max: 500 }),
  validate(joinPresentationSchema),
  PresentationController.join
);
router.post(
  '/:id/answer',
  rateLimit({ prefix: 'presentation-answer', windowSec: 60, max: 2000 }),
  validate(submitPresentationAnswerSchema),
  PresentationController.answer
);
router.get(
  '/:id/me',
  rateLimit({ prefix: 'presentation-me', windowSec: 60, max: 600 }),
  PresentationController.participantState
);

// Creator CRUD
router.post('/', authenticate(), validate(createPresentationSchema), PresentationController.create);
router.get('/', authenticate(), PresentationController.listByCreator);
router.get('/:id', authenticate(), PresentationController.getById);
router.patch('/:id', authenticate(), validate(updatePresentationSchema), PresentationController.update);
router.delete('/:id', authenticate(), PresentationController.delete);

// Host session controls
router.get('/:id/host/state', authenticate(), PresentationController.hostState);
router.post('/:id/host/open-lobby', authenticate(), PresentationController.openLobby);
router.post('/:id/host/next-question', authenticate(), PresentationController.startNextQuestion);
router.post('/:id/host/reveal', authenticate(), PresentationController.reveal);
router.post('/:id/host/leaderboard', authenticate(), PresentationController.showLeaderboard);
router.post('/:id/host/end', authenticate(), PresentationController.end);

export default router;
