import { Router } from 'express';
import { PresentationAudienceController } from '../controllers/audience.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { rateLimit } from '../../../common/middlewares/rateLimit.middleware';
import { workspaceContext } from '../../../common/tenancy/workspaceContext.middleware';
import { authenticate } from '../../auth/auth.middleware';
import { audienceAttemptSchema, openAudienceSchema } from '../presentations.schema';
// Registers the job that closes audience-paced sessions at their closing time.
import '../live/audienceAutoClose';

/**
 * Audience pace (W2-F). Host: open every response slide at once (optionally
 * until a closing time) and close them — policy `deck:host`, like every host
 * command. Participants (participant token, rate limited per IP like answers):
 * submit an attempt, retry a failed assessment.
 */
const router = Router();

const hostLimit = rateLimit({ prefix: 'presentation-audience-host', windowSec: 60, max: 60 });
router.post(
  '/:id/host/open-audience',
  hostLimit,
  authenticate(),
  workspaceContext(),
  validate(openAudienceSchema),
  PresentationAudienceController.openAudience
);
router.post('/:id/host/close-audience', hostLimit, authenticate(), workspaceContext(), PresentationAudienceController.closeAudience);

const attemptLimit = rateLimit({ prefix: 'presentation-audience-attempt', windowSec: 60, max: 600 });
router.post('/:id/audience/submit', attemptLimit, validate(audienceAttemptSchema), PresentationAudienceController.submit);
router.post('/:id/audience/retry', attemptLimit, validate(audienceAttemptSchema), PresentationAudienceController.retry);

export default router;
