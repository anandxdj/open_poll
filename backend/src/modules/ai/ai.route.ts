import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { authenticate } from '../auth/auth.middleware';
import { AiController } from './ai.controller';
import {
  generateAndSavePollRequestSchema,
  generatePollRequestSchema,
  generateQuizRequestSchema,
} from './ai.schema';

const router = Router();

// Every route spends LLM quota and feeds an authenticated builder, so all of
// them sit behind auth and share one per-IP budget.
const aiLimit = rateLimit({ prefix: 'ai', windowSec: 300, max: 20 });

router.post('/generate', authenticate(), aiLimit, validate(generatePollRequestSchema), AiController.generateDraft);
router.post(
  '/generate-and-save',
  authenticate(),
  aiLimit,
  validate(generateAndSavePollRequestSchema),
  AiController.generateAndSave,
);
router.post('/generate-quiz', authenticate(), aiLimit, validate(generateQuizRequestSchema), AiController.generateQuizDraft);

export default router;
