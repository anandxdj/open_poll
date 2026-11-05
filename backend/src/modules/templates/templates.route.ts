import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { TemplatesController } from './templates.controller';
import { saveTemplateSchema, useTemplateSchema } from './templates.schema';

/**
 * Templates (W3-B2), mounted at /api/templates by src/http/routes.ts. Every
 * route runs in the X-Workspace-Id workspace (workspaceContext()).
 * - GET    /          starter templates + the workspace's templates
 * - POST   /          { presentationId, title? } save a deck as a workspace template
 * - POST   /:id/use   { title? } a new draft deck from a starter (slug) or workspace template (id)
 * - DELETE /:id       delete a workspace template
 */
const router = Router();

// Save and use each write a whole deck from a small request: per user, like duplicate.
const byUser = (req: Request) => (req as AuthRequest).user?.id;
const copyLimit = rateLimit({ prefix: 'templates:copy', windowSec: 60, max: 30, keyBy: byUser });

router.get('/', authenticate(), workspaceContext(), TemplatesController.list);
router.post('/', authenticate(), copyLimit, workspaceContext(), validate(saveTemplateSchema), TemplatesController.save);
router.post('/:id/use', authenticate(), copyLimit, workspaceContext(), validate(useTemplateSchema), TemplatesController.use);
router.delete('/:id', authenticate(), workspaceContext(), TemplatesController.remove);

export default router;
