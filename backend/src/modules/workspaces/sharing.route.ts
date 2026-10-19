import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { putSharesSchema } from './members.schema';
import { SharingController } from './sharing.controller';

/**
 * Mounted at /api/shares by src/http/routes.ts.
 * - GET /?resourceType&resourceId   who a deck or folder is shared with
 * - PUT /?resourceType&resourceId   replace the complete set of grants
 * Runs in the X-Workspace-Id workspace like the deck routes; the resource must
 * belong to it. Both need `deck:share` there.
 */
const router = Router();

const byUser = (req: Request) => (req as AuthRequest).user?.id;
const readLimit = rateLimit({ prefix: 'shares-read', windowSec: 60, max: 120, keyBy: byUser });
const writeLimit = rateLimit({ prefix: 'shares-write', windowSec: 60, max: 60, keyBy: byUser });

router.get('/', authenticate(), workspaceContext(), readLimit, SharingController.list);
router.put('/', authenticate(), workspaceContext(), writeLimit, validate(putSharesSchema), SharingController.replace);

export default router;
