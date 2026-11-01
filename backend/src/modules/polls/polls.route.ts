import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollRequestSchema, updatePollSchema } from './polls.schema';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';

const router = Router();

// Authenticated routes act in the caller's workspace (X-Workspace-Id, else the
// default one) and authorize with assertCan in the controller. The public read
// keeps optional auth; drafts there are checked against the same policy.

// POST /api/polls
// createPollRequestSchema adds the published-assessment gradeability rules on top
// of createPollSchema. PATCH cannot do the same here: whether a poll is a TRIAL
// is only known once the stored poll is fetched, so PollService.updatePoll owns it.
router.post('/', authenticate(), validate(createPollRequestSchema), workspaceContext(), PollController.create);
router.get('/', authenticate(), workspaceContext(), PollController.list);
// Public read (with optional auth): drafts are only visible inside their workspace.
router.get('/:id', authenticate(true), PollController.getById);
router.patch('/:pollId', authenticate(), validate(updatePollSchema), workspaceContext(), PollController.update);
router.post('/:id/close', authenticate(), workspaceContext(), PollController.close);
router.post('/:id/publish-results', authenticate(), workspaceContext(), PollController.publishResults);
router.delete('/:id', authenticate(), workspaceContext(), PollController.delete);
// Read the source, create the copy as a draft in the current workspace. Per-user
// limit: a body-less request writes a whole poll.
router.post(
  '/:id/duplicate',
  authenticate(),
  rateLimit({ prefix: 'polls:duplicate', windowSec: 60, max: 30, keyBy: (req) => (req as AuthRequest).user?.id }),
  workspaceContext(),
  PollController.duplicate,
);

export default router;