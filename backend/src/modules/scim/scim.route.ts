import { Router } from 'express';

// W3-D (SSO and SCIM) adds the routes; src/http/routes.ts mounts this router at /scim/v2 with a SCIM JSON parser, ahead of CORS and mongoSanitize.
const router = Router();

export default router;
