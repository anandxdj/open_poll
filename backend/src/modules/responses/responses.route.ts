import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { ResponsesController } from './responses.controller';
import { submitResponseSchema } from './responses.schema';

const router = Router();

router.post('/', validate(submitResponseSchema), ResponsesController.submit);
router.get('/poll/:pollId/summary', ResponsesController.getSummary);

export default router;
