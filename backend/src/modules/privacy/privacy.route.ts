import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { PrivacyController } from './privacy.controller';
import { reauthSchema } from './privacy.schema';
// Registers the account purge and session retention jobs.
import './privacy.purge';

/**
 * Mounted at /api/me by src/http/routes.ts. The signed-in user's own account,
 * no workspace context (W4-C):
 *
 * - GET    /privacy   what the privacy page needs: re-auth window, deletion blockers, recent exports
 * - POST   /export    a zip of the user's data (EXPORTS_PER_DAY a day)
 * - POST   /reauth    password accounts confirm their password (5 minutes)
 * - DELETE /          schedules the account's deletion (fresh sign-in or re-auth needed)
 */
const router = Router();

const perUser = (prefix: string, windowSec: number, max: number) =>
  rateLimit({ prefix, windowSec, max, keyBy: (req) => (req as AuthRequest).user?.id, onStoreError: 'memory' });

router.get('/privacy', authenticate(), perUser('privacy:status', 60, 60), PrivacyController.status);
router.post('/export', authenticate(), perUser('privacy:export', 3600, 10), PrivacyController.export);
router.post('/reauth', authenticate(), perUser('privacy:reauth', 900, 10), validate(reauthSchema), PrivacyController.reauth);
router.delete('/', authenticate(), perUser('privacy:delete', 900, 10), PrivacyController.remove);

export default router;
