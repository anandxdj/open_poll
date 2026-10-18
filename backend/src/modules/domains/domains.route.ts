import { Router } from 'express';

// W4-E (Custom domains and white-label) adds the routes; src/http/routes.ts mounts this router at /api/workspaces/:workspaceId/domains.
const router = Router({ mergeParams: true });

// W4-E: host resolution and the on-demand TLS check, mounted at /api/public/domains.
export const publicDomainsRouter = Router();

export default router;
