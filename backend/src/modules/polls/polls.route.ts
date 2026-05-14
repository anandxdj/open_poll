import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollSchema, updatePollSchema } from './polls.schema';

const router = Router();

// POST /api/polls
router.post('/', validate(createPollSchema), PollController.create);
router.get('/', PollController.listByCreator);
router.get('/:id', PollController.getById);
router.patch('/:pollId', validate(updatePollSchema), PollController.update);
router.post('/:id/close', PollController.close);
router.post('/:id/publish-results', PollController.publishResults);
router.delete('/:id', PollController.delete);

export default router;