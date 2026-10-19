import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { pathWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { MembersController } from './members.controller';
import { updateMemberSchema } from './members.schema';

/**
 * Mounted at /api/workspaces/:workspaceId/members by src/http/routes.ts. The
 * workspace comes from the path (pathWorkspaceContext), not X-Workspace-Id: a
 * non-member gets 403 WORKSPACE_FORBIDDEN. Authorization per route is in
 * MembersService (`workspace:members`, rank rules, owner guards).
 */
const router = Router({ mergeParams: true });

const byUser = (req: Request) => (req as AuthRequest).user?.id;
const readLimit = rateLimit({ prefix: 'members-read', windowSec: 60, max: 120, keyBy: byUser });
const writeLimit = rateLimit({ prefix: 'members-write', windowSec: 60, max: 60, keyBy: byUser });

router.get('/', authenticate(), pathWorkspaceContext(), readLimit, MembersController.list);
router.patch('/:userId', authenticate(), pathWorkspaceContext(), writeLimit, validate(updateMemberSchema), MembersController.update);
router.delete('/:userId', authenticate(), pathWorkspaceContext(), writeLimit, MembersController.remove);
router.post(
  '/:userId/transfer-ownership',
  authenticate(),
  pathWorkspaceContext(),
  writeLimit,
  MembersController.transferOwnership,
);

export default router;
