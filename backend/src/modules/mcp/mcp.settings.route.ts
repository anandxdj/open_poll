import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { createMcpTokenSchema } from './mcp.schema';
import { McpSettingsController } from './mcp.settings.controller';

const router = Router();

router.post('/tokens', authenticate(), validate(createMcpTokenSchema), McpSettingsController.createToken as any);
router.get('/tokens', authenticate(), McpSettingsController.listTokens as any);
router.delete('/tokens/:tokenId', authenticate(), McpSettingsController.revokeToken as any);
router.get('/grants', authenticate(), McpSettingsController.listGrants as any);
router.delete('/grants/:grantId', authenticate(), McpSettingsController.revokeGrant as any);

export default router;
