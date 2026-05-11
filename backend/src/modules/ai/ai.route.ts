import { Router } from 'express';
import { validate } from '../../common/middlewares/validate.middleware';
import { AiController } from './ai.controller';
import { generateAndSavePollRequestSchema, generatePollRequestSchema } from './ai.schema';

const router = Router();

router.post('/generate', validate(generatePollRequestSchema), AiController.generateDraft);
router.post('/generate-and-save', validate(generateAndSavePollRequestSchema), AiController.generateAndSave);

export default router;
