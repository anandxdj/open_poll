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

router.post('/generate', validate(generatePollRequestSchema), AiController.generateDraft);
router.post('/generate-and-save', validate(generateAndSavePollRequestSchema), AiController.generateAndSave);

// Quiz drafts go straight into the authenticated builder — keep the LLM behind auth + a rate limit
router.post(
  '/generate-quiz',
  authenticate(),
  rateLimit({ prefix: 'ai-quiz', windowSec: 300, max: 20 }),
  validate(generateQuizRequestSchema),
  AiController.generateQuizDraft
);

export default router;
