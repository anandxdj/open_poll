import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { authenticate } from '../auth/auth.middleware';
import { ResponsesController } from './responses.controller';
import { submitResponseSchema } from './responses.schema';

const router = Router();

router.post('/', authenticate(true) as any, validate(submitResponseSchema), ResponsesController.submit);
router.get('/poll/:pollId/summary', ResponsesController.getSummary);

export default router;
