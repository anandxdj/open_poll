import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { AiController } from './ai.controller';
import {
  generateAndSavePollRequestSchema,
  generatePollRequestSchema,
  generateQuizRequestSchema,
} from './ai.schema';

const router = Router();

router.post('/generate', validate(generatePollRequestSchema), AiController.generateDraft);
router.post('/generate-and-save', validate(generateAndSavePollRequestSchema), AiController.generateAndSave);
router.post('/generate-quiz', validate(generateQuizRequestSchema), AiController.generateQuizDraft);

export default router;
