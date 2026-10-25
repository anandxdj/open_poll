import { Router } from 'express';

// W3-D (SSO and SCIM) adds the routes; src/http/routes.ts mounts this router at /api/sso.
const router = Router();

// W3-D: SAML assertion consumer, mounted at /api/sso/saml/:connectionId/acs behind express.urlencoded, ahead of CORS.
export const samlAcsRouter = Router({ mergeParams: true });

export default router;
