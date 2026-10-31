import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { InsightsController } from './insights.controller';

/**
 * Workspace insights (W3-G), mounted at /api/insights by src/http/routes.ts.
 *
 * - GET /?from&to&tz   activity in a range: totals with the previous period,
 *                      a daily series, top decks and polls, recent sessions,
 *                      what is live now (`session:read`, every member role)
 */
const router = Router();

// A handful of aggregations per call: per user, generous for a page that refetches on range changes.
const insightsLimit = rateLimit({
  prefix: 'insights',
  windowSec: 60,
  max: 60,
  keyBy: (req) => (req as AuthRequest).user?.id,
});

router.get('/', authenticate(), workspaceContext(), insightsLimit, InsightsController.get);

export default router;
