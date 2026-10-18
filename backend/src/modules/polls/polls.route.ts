import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollRequestSchema, updatePollSchema } from './polls.schema';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

// POST /api/polls
// createPollRequestSchema adds the published-assessment gradeability rules on top
// of createPollSchema. PATCH cannot do the same here: whether a poll is a TRIAL
// is only known once the stored poll is fetched, so PollService.updatePoll owns it.
router.post('/', authenticate(), validate(createPollRequestSchema), PollController.create);
router.get('/', authenticate(), PollController.listByCreator);
// Public read (with optional auth): drafts are only visible to their creator.
router.get('/:id', authenticate(true), PollController.getById);
router.patch('/:pollId', authenticate(), validate(updatePollSchema), PollController.update);
router.post('/:id/close', authenticate(), PollController.close);
router.post('/:id/publish-results', authenticate(), PollController.publishResults);
router.delete('/:id', authenticate(), PollController.delete);

export default router;