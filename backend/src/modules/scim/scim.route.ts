import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { pathWorkspaceContext, type WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { scimAuth, type ScimRequest } from './scim.auth';
import { resourceTypes, schemas, serviceProviderConfig } from './scim.discovery';
import { ScimError, sendScim, sendScimError } from './scim.errors';
import { ScimGroups } from './scim.groups';
import { ScimTokenService } from './scim.tokens';
import { ScimUsers, type ScimActor } from './scim.users';

/**
 * SCIM 2.0 provisioning (W3-D), mounted at /scim/v2 by mountPreParserRoutes
 * with a JSON parser for application/scim+json, ahead of CORS and
 * mongoSanitize. Bearer ScimToken; every answer and error is SCIM JSON.
 *
 * - GET /ServiceProviderConfig · /ResourceTypes · /Schemas
 * - GET|POST /Users · GET|PUT|PATCH|DELETE /Users/:id
 * - GET|POST /Groups · GET|PUT|PATCH|DELETE /Groups/:id
 *
 * Token management (scimAdminRouter, /api/workspaces/:workspaceId/scim, team workspaces,
 * `workspace:sso`, plan `scim`): GET /tokens · POST /tokens · DELETE /tokens/:tokenId
 */
const router = Router();

// One IdP sync can send many requests at once: per token, generous.
const scimLimit = rateLimit({
  prefix: 'scim',
  windowSec: 60,
  max: 600,
  keyBy: (req) => (req as ScimRequest).scim?.tokenId,
  onStoreError: 'memory',
});

type ScimHandler = (scim: ScimActor, req: ScimRequest) => Promise<unknown>;

const scimRoute =
  (handler: ScimHandler, status = 200) =>
  async (req: ScimRequest, res: Response, next: NextFunction) => {
    try {
      const body = await handler(req.scim!, req);
      if (status === 204) return void res.status(204).end();
      sendScim(res, status, body);
    } catch (error) {
      if (error instanceof ScimError) return void sendScimError(res, error);
      next(error);
    }
  };

const idOf = (req: Request) => String(req.params.id ?? '');
const bodyOf = (req: Request) => (req.body && typeof req.body === 'object' ? (req.body as Record<string, any>) : {});

router.use(scimAuth, scimLimit);

router.get('/ServiceProviderConfig', scimRoute(async () => serviceProviderConfig()));
router.get('/ResourceTypes', scimRoute(async () => resourceTypes()));
router.get('/Schemas', scimRoute(async () => schemas()));

router.get('/Users', scimRoute((scim, req) => ScimUsers.list(scim, req.query)));
router.post('/Users', scimRoute((scim, req) => ScimUsers.create(scim, bodyOf(req)), 201));
router.get('/Users/:id', scimRoute((scim, req) => ScimUsers.get(scim, idOf(req))));
router.put('/Users/:id', scimRoute((scim, req) => ScimUsers.replace(scim, idOf(req), bodyOf(req))));
router.patch('/Users/:id', scimRoute((scim, req) => ScimUsers.patch(scim, idOf(req), bodyOf(req))));
router.delete('/Users/:id', scimRoute((scim, req) => ScimUsers.remove(scim, idOf(req)), 204));

router.get('/Groups', scimRoute((scim, req) => ScimGroups.list(scim, req.query)));
router.post('/Groups', scimRoute((scim, req) => ScimGroups.create(scim, bodyOf(req)), 201));
router.get('/Groups/:id', scimRoute((scim, req) => ScimGroups.get(scim, idOf(req))));
router.put('/Groups/:id', scimRoute((scim, req) => ScimGroups.replace(scim, idOf(req), bodyOf(req))));
router.patch('/Groups/:id', scimRoute((scim, req) => ScimGroups.patch(scim, idOf(req), bodyOf(req))));
router.delete('/Groups/:id', scimRoute((scim, req) => ScimGroups.remove(scim, idOf(req)), 204));

// Unknown SCIM paths answer in SCIM's format too.
router.use((_req: Request, res: Response) => void sendScimError(res, new ScimError(404, 'Not found')));

export const scimAdminRouter = Router({ mergeParams: true });

type Ctx = Parameters<typeof ScimTokenService.list>[0];
const handle =
  (fn: (req: Ctx, res: Response) => Promise<unknown>) => async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      await fn(req as Ctx, res);
    } catch (error) {
      next(error);
    }
  };

const writeLimit = rateLimit({ prefix: 'scim:tokens', windowSec: 60, max: 30, keyBy: (req) => (req as AuthRequest).user?.id });
const tokenSchema = z.strictObject({ label: z.string().trim().min(1, 'Name the token').max(80) });

scimAdminRouter.get('/tokens', authenticate(), pathWorkspaceContext(), handle(async (req, res) => ApiResponse.ok(res, 'SCIM tokens fetched', await ScimTokenService.list(req))));
scimAdminRouter.post(
  '/tokens',
  authenticate(),
  pathWorkspaceContext(),
  writeLimit,
  validate(tokenSchema),
  handle(async (req, res) => ApiResponse.created(res, 'SCIM token created', await ScimTokenService.create(req, req.body.label)))
);
scimAdminRouter.delete(
  '/tokens/:tokenId',
  authenticate(),
  pathWorkspaceContext(),
  writeLimit,
  handle(async (req, res) => ApiResponse.ok(res, 'SCIM token revoked', await ScimTokenService.revoke(req, String(req.params.tokenId))))
);

export default router;
