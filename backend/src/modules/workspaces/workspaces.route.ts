import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { WorkspacesController } from './workspaces.controller';
import { createWorkspaceSchema, updateWorkspaceSchema } from './workspaces.schema';

/**
 * Mounted at /api/workspaces by src/http/routes.ts. Routes with `:id` act on
 * the workspace in the path, resolved like X-Workspace-Id: a live workspace
 * with an active membership, else 403 WORKSPACE_FORBIDDEN. They ignore the
 * header, so a stale selection never locks the switcher out.
 */
const router = Router();

// Creating workspaces is plan-gated in the service; this only stops scripted bursts.
const createLimit = rateLimit({
  prefix: 'workspace-create',
  windowSec: 3600,
  max: 20,
  keyBy: (req: Request) => (req as AuthRequest).user?.id,
});

router.get('/', authenticate(), WorkspacesController.list);
router.post('/', authenticate(), createLimit, validate(createWorkspaceSchema), WorkspacesController.create);
router.get('/:id', authenticate(), WorkspacesController.get);
router.patch('/:id', authenticate(), validate(updateWorkspaceSchema), WorkspacesController.update);
router.post('/:id/switch', authenticate(), WorkspacesController.switch);

export default router;
