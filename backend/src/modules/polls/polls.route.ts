import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollSchema, updatePollSchema } from './polls.schema';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

// POST /api/polls
router.post('/', authenticate(), validate(createPollSchema), PollController.create);
router.get('/', authenticate(), PollController.listByCreator);
router.get('/:id', PollController.getById);
router.patch('/:pollId', authenticate(), validate(updatePollSchema), PollController.update);
router.post('/:id/close', authenticate(), PollController.close);
router.post('/:id/publish-results', authenticate(), PollController.publishResults);
router.delete('/:id', authenticate(), PollController.delete);

export default router;