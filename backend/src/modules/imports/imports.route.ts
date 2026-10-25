import { Router } from 'express';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { ImportsController } from './imports.controller';
import { createImportSchema } from './import.schema';

/**
 * Mounted at /api/imports by src/http/routes.ts. Contract:
 * backend/docs/wiki/modules/imports.md.
 */
const router = Router();

const perUser = (req: unknown) => (req as AuthRequest).user?.id;

// Starting an import queues heavy work (parsing, rendering): few per minute per account.
const createLimit = rateLimit({ prefix: 'imports:create', windowSec: 60, max: 10, keyBy: perUser });
const questionsLimit = rateLimit({ prefix: 'imports:questions', windowSec: 60, max: 20, keyBy: perUser });
// Polled while a job runs.
const readLimit = rateLimit({ prefix: 'imports:read', windowSec: 60, max: 240, keyBy: perUser });
const templateLimit = rateLimit({ prefix: 'imports:template', windowSec: 60, max: 30 });

// Static paths first: `/:id` would swallow them.
router.get('/templates/questions.:format', templateLimit, ImportsController.template);
router.post('/questions', authenticate(), questionsLimit, workspaceContext(), ImportsController.questions);
router.post('/', authenticate(), createLimit, workspaceContext(), validate(createImportSchema), ImportsController.create);
router.get('/:id', authenticate(), readLimit, ImportsController.get);

export default router;
