import { Router, type NextFunction, type Response } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { workspaceContext, type WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { auditQuerySchema, AuditService } from './audit.service';

/**
 * Mounted at /api/audit by src/http/routes.ts.
 * - GET /?action&actor&cursor&limit   the current workspace's audit events (`workspace:manage`)
 */
const router = Router();

const readLimit = rateLimit({
  prefix: 'audit-read',
  windowSec: 60,
  max: 120,
  keyBy: (req) => (req as AuthRequest).user?.id,
});

router.get('/', authenticate(), workspaceContext(), readLimit, async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw ApiError.unauthorized('Not authenticated');
    if (!req.workspace) throw ApiError.internal('Workspace context is missing');
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    }
    const page = await AuditService.list(
      { user: req.user, workspace: req.workspace, membership: req.membership },
      parsed.data,
    );
    return ApiResponse.ok(res, 'Audit log fetched successfully', page);
  } catch (error) {
    next(error);
  }
});

export default router;
