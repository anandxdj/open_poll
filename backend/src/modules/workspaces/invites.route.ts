import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { pathWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { InviteLinkController, WorkspaceInvitesController } from './members.controller';
import { createInviteSchema } from './members.schema';

const byUser = (req: Request) => (req as AuthRequest).user?.id;

/**
 * Mounted at /api/workspaces/:workspaceId/invites by src/http/routes.ts: the
 * workspace's invitations, for `workspace:members` holders.
 */
const router = Router({ mergeParams: true });

// Mail is the abuse vector: cap sends per inviter and, separately, per address.
const createLimit = rateLimit({ prefix: 'invite-create', windowSec: 3600, max: 60, keyBy: byUser });
const perAddressLimit = rateLimit({ prefix: 'invite-address', windowSec: 3600, max: 5, keyBy: (req) => `${req.params.workspaceId}:${req.body?.email}` });
const readLimit = rateLimit({ prefix: 'invite-read', windowSec: 60, max: 120, keyBy: byUser });
const revokeLimit = rateLimit({ prefix: 'invite-revoke', windowSec: 60, max: 60, keyBy: byUser });

router.post(
  '/',
  authenticate(),
  pathWorkspaceContext(),
  createLimit,
  validate(createInviteSchema),
  perAddressLimit,
  WorkspaceInvitesController.create,
);
router.get('/', authenticate(), pathWorkspaceContext(), readLimit, WorkspaceInvitesController.list);
router.delete('/:inviteId', authenticate(), pathWorkspaceContext(), revokeLimit, WorkspaceInvitesController.revoke);

export default router;

/**
 * Mounted at /api/invites: the invitee's side. The token in the URL is the
 * credential (256 random bits, stored hashed, single use), so the preview is
 * public but rate-limited per IP, and accepting also needs the signed-in
 * user's verified email to match the invited address.
 */
export const invitesRouter = Router();

const previewLimit = rateLimit({ prefix: 'invite-preview', windowSec: 600, max: 60 });
const acceptIpLimit = rateLimit({ prefix: 'invite-accept-ip', windowSec: 600, max: 30 });
const acceptUserLimit = rateLimit({ prefix: 'invite-accept-user', windowSec: 600, max: 20, keyBy: byUser });

invitesRouter.get('/:token', previewLimit, InviteLinkController.preview);
invitesRouter.post('/:token/accept', acceptIpLimit, authenticate(), acceptUserLimit, InviteLinkController.accept);
