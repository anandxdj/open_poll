import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { pathWorkspaceContext, type WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { CustomDomainModel } from './customDomain.model';
import { DomainsService, resolveDomain } from './domains.service';

/**
 * Custom domains and white-label (W4-E).
 *
 * Settings (mounted at /api/workspaces/:workspaceId/domains; `workspace:domains`, plan
 * `custom_domains`, server DOMAIN_PROVISIONER):
 * - GET /                    the CNAME target and the workspace's domains with their DNS records
 * - POST /                   add a hostname (pending)
 * - POST /:domainId/verify   check TXT and CNAME; when both are there, provision and serve it
 * - DELETE /:domainId
 *
 * Public (publicDomainsRouter, /api/public/domains; allow-listed):
 * - GET /resolve?host        what an active custom hostname serves (the frontend proxy asks)
 * - GET /tls-ask?domain      200 for active hostnames, 404 otherwise (Caddy on-demand TLS)
 */
const router = Router({ mergeParams: true });

type Ctx = Parameters<typeof DomainsService.list>[0];
const handle =
  (fn: (req: Ctx, res: Response) => Promise<unknown>) => async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      await fn(req as Ctx, res);
    } catch (error) {
      next(error);
    }
  };

const writeLimit = rateLimit({ prefix: 'domains:write', windowSec: 60, max: 30, keyBy: (req) => (req as AuthRequest).user?.id });
const addSchema = z.strictObject({ hostname: z.string().trim().min(3).max(253) });
const admin = [authenticate(), pathWorkspaceContext()] as const;
const domainId = (req: Request) => String(req.params.domainId ?? '');

router.get('/', ...admin, handle(async (req, res) => ApiResponse.ok(res, 'Domains fetched', await DomainsService.list(req))));
router.post('/', ...admin, writeLimit, validate(addSchema), handle(async (req, res) => ApiResponse.created(res, 'Domain added', await DomainsService.add(req, req.body.hostname))));
router.post('/:domainId/verify', ...admin, writeLimit, handle(async (req, res) => ApiResponse.ok(res, 'Domain checked', await DomainsService.verify(req, domainId(req)))));
router.delete('/:domainId', ...admin, writeLimit, handle(async (req, res) => ApiResponse.ok(res, 'Domain removed', await DomainsService.remove(req, domainId(req)))));

export const publicDomainsRouter = Router();

// The frontend proxy caches answers for a minute per host; Caddy asks once per certificate.
const publicLimit = rateLimit({ prefix: 'domains:public', windowSec: 60, max: 600, onStoreError: 'memory' });

publicDomainsRouter.get('/resolve', publicLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resolved = await resolveDomain(typeof req.query.host === 'string' ? req.query.host : '');
    if (!resolved) throw new ApiError(404, 'Unknown domain', 'DOMAIN_NOT_FOUND');
    res.setHeader('Cache-Control', 'public, max-age=60');
    ApiResponse.ok(res, 'Domain resolved', resolved);
  } catch (error) {
    next(error);
  }
});

publicDomainsRouter.get('/tls-ask', publicLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const domain = typeof req.query.domain === 'string' ? req.query.domain.trim().toLowerCase() : '';
    const active = domain ? await CustomDomainModel.exists({ hostname: domain, status: 'active' }) : null;
    res.status(active ? 200 : 404).end();
  } catch (error) {
    next(error);
  }
});

export default router;
