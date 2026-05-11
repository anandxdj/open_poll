import { Router } from 'express';
import { PollController } from './polls.controller';
import { validate } from '../../common/middlewares/validate.middleware';
import { createPollSchema, updatePollSchema } from './polls.schema';

const router = Router();

// POST /api/polls
router.post('/', validate(createPollSchema), PollController.create);
router.get('/', PollController.listByCreator);
router.get('/:pollId', PollController.getById);
router.patch('/:pollId', validate(updatePollSchema), PollController.update);
router.post('/:pollId/close', PollController.close);

export default router;