import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { pathWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { SsoAdminController, SsoController } from './sso.controller';
import { createConnectionSchema, domainSchema, metadataSchema, updateConnectionSchema } from './sso.schema';

/**
 * Workspace single sign-on (W3-D).
 *
 * Signing in (no account yet; mounted at /api/sso, allow-listed in the tenancy test):
 * - GET  /discover?email                    the connection for an email's verified domain
 * - GET  /:connectionId/login               redirect to the IdP (`?test=<token>`: an admin's test run)
 * - GET  /saml/:connectionId/metadata       SP metadata
 * - POST /saml/:connectionId/acs            SAML response (samlAcsRouter, a pre-parser mount with urlencoded)
 * - GET  /oidc/:connectionId/callback       OIDC redirect back
 *
 * Settings (ssoAdminRouter, /api/workspaces/:workspaceId/sso, team workspaces, `workspace:sso`, plan `sso`):
 * - GET / · POST /connections · PATCH|DELETE /connections/:connectionId
 * - POST /connections/:connectionId/metadata        import IdP metadata XML
 * - POST /connections/:connectionId/domains · POST .../domains/:domain/verify · DELETE .../domains/:domain
 * - POST /connections/:connectionId/test            a one-time test sign-in link
 */
const router = Router();

const perIp = (prefix: string, max: number) => rateLimit({ prefix, windowSec: 60, max, onStoreError: 'memory' });

router.get('/discover', perIp('sso:discover', 30), SsoController.discover);
router.get('/saml/:connectionId/metadata', perIp('sso:metadata', 60), SsoController.metadata);
router.get('/oidc/:connectionId/callback', perIp('sso:callback', 30), SsoController.oidcCallback);
router.get('/:connectionId/login', perIp('sso:login', 30), SsoController.login);

export const samlAcsRouter = Router({ mergeParams: true });
samlAcsRouter.post('/', perIp('sso:acs', 30), SsoController.acs);

export const ssoAdminRouter = Router({ mergeParams: true });

const writeLimit = rateLimit({ prefix: 'sso:admin', windowSec: 60, max: 60, keyBy: (req) => (req as AuthRequest).user?.id });
const admin = [authenticate(), pathWorkspaceContext()] as const;

ssoAdminRouter.get('/', ...admin, SsoAdminController.list);
ssoAdminRouter.post('/connections', ...admin, writeLimit, validate(createConnectionSchema), SsoAdminController.create);
ssoAdminRouter.patch('/connections/:connectionId', ...admin, writeLimit, validate(updateConnectionSchema), SsoAdminController.update);
ssoAdminRouter.delete('/connections/:connectionId', ...admin, writeLimit, SsoAdminController.remove);
ssoAdminRouter.post('/connections/:connectionId/metadata', ...admin, writeLimit, validate(metadataSchema), SsoAdminController.metadata);
ssoAdminRouter.post('/connections/:connectionId/domains', ...admin, writeLimit, validate(domainSchema), SsoAdminController.addDomain);
ssoAdminRouter.post('/connections/:connectionId/domains/:domain/verify', ...admin, writeLimit, SsoAdminController.verifyDomain);
ssoAdminRouter.delete('/connections/:connectionId/domains/:domain', ...admin, writeLimit, SsoAdminController.removeDomain);
ssoAdminRouter.post('/connections/:connectionId/test', ...admin, writeLimit, SsoAdminController.test);

export default router;
