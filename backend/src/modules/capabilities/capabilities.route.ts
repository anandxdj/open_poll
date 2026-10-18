import { Router } from 'express';
import { env } from '../../common/config/env';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';

/**
 * Mounted at /api/capabilities by src/http/routes.ts. Public: which optional
 * features this deployment offers (env.capabilities), so the frontend can
 * disable the rest with an explanation. Plan entitlements are per workspace
 * and separate.
 */
const router = Router();

router.get('/', rateLimit({ prefix: 'capabilities', windowSec: 60, max: 120 }), (_req, res) =>
  ApiResponse.ok(res, 'Capabilities fetched successfully', env.capabilities),
);

export default router;
