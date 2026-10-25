import { Router } from 'express';
import { PresentationParticipantController } from '../controllers/participant.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { rateLimit } from '../../../common/middlewares/rateLimit.middleware';
import { joinPresentationSchema, submitPresentationAnswerSchema } from '../presentations.schema';

const router = Router();

// Public participant flow (no auth — participants join with a nickname).
// Rate limits are per-IP and sized for classroom NAT (many players, one IP):
// they exist to stop bots/enumeration, not to throttle legit bursts.
router.get(
  '/code/:code',
  rateLimit({ prefix: 'presentation-code', windowSec: 60, max: 60 }),
  // Per-IP alone doesn't stop enumeration spread across many IPs — cap total
  // lookups system-wide too. 300k/hr is still far short of exhausting the
  // 900k code space before a live session ends.
  rateLimit({ prefix: 'presentation-code-global', windowSec: 60, max: 5000, keyBy: 'global' }),
  PresentationParticipantController.getByCode
);
router.post(
  '/:id/join',
  rateLimit({ prefix: 'presentation-join', windowSec: 300, max: 500 }),
  validate(joinPresentationSchema),
  PresentationParticipantController.join
);
router.post(
  '/:id/answer',
  rateLimit({ prefix: 'presentation-answer', windowSec: 60, max: 2000 }),
  validate(submitPresentationAnswerSchema),
  PresentationParticipantController.answer
);
router.get(
  '/:id/me',
  rateLimit({ prefix: 'presentation-me', windowSec: 60, max: 600 }),
  PresentationParticipantController.participantState
);
// Full participant resync after a reconnect (shares the /me budget).
router.get(
  '/:id/live-state',
  rateLimit({ prefix: 'presentation-me', windowSec: 60, max: 600 }),
  PresentationParticipantController.liveState
);

export default router;
