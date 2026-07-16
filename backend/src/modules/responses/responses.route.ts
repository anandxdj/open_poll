import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { authenticate } from '../auth/auth.middleware';
import { ResponsesController } from './responses.controller';
import { issueGuestTokenSchema, submitResponseSchema } from './responses.schema';

const router = Router();

// Ballot minting: rate-limited per IP so one machine can't stockpile ballots.
router.post(
  '/poll/:pollId/ballot',
  rateLimit({ prefix: 'ballot-issue', windowSec: 3600, max: 30 }),
  ResponsesController.issueBallot,
);
// Guest identity: server signs the name/email pair so it can't be forged later.
router.post(
  '/guest-token',
  rateLimit({ prefix: 'guest-token', windowSec: 3600, max: 20 }),
  validate(issueGuestTokenSchema),
  ResponsesController.issueGuestToken,
);
router.post(
  '/',
  rateLimit({ prefix: 'response-submit', windowSec: 60, max: 30 }),
  authenticate(true) as any,
  validate(submitResponseSchema),
  ResponsesController.submit,
);
router.get('/poll/:pollId/summary', ResponsesController.getSummary);
router.get('/poll/:pollId/list', authenticate() as any, ResponsesController.getResponsesList);

export default router;
