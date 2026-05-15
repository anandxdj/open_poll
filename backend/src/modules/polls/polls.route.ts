import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollSchema, updatePollSchema } from './polls.schema';
import { authenticate } from '../auth/auth.middleware';

const router = Router();

// POST /api/polls
router.post('/', authenticate as any, validate(createPollSchema), PollController.create);
router.get('/', authenticate as any, PollController.listByCreator);
router.get('/:id', PollController.getById);
router.patch('/:pollId', authenticate as any, validate(updatePollSchema), PollController.update);
router.post('/:id/close', authenticate as any, PollController.close);
router.post('/:id/publish-results', authenticate as any, PollController.publishResults);
router.delete('/:id', authenticate as any, PollController.delete);

export default router;