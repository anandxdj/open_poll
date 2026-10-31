import { Router } from 'express';
import { authenticate } from '../../auth/auth.middleware';
import { validate } from '../../../common/middlewares/validate.middleware';
import { rateLimit } from '../../../common/middlewares/rateLimit.middleware';
import { approveOAuthRequestSchema } from '../mcp.schema';
import { OAuthConsentController } from './oauth.consent.controller';

const router = Router();

const consentLimit = rateLimit({ prefix: 'mcp-oauth-consent', windowSec: 60, max: 30, keyBy: 'ip', onStoreError: 'memory' });

router.get('/requests/:requestId', consentLimit, authenticate(), OAuthConsentController.get as any);
router.post(
  '/requests/:requestId/approve',
  consentLimit,
  authenticate(),
  validate(approveOAuthRequestSchema),
  OAuthConsentController.approve as any,
);
router.post('/requests/:requestId/deny', consentLimit, authenticate(), OAuthConsentController.deny as any);

export default router;
