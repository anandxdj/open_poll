import { Router } from 'express';

// W3-A (Themes and branding) adds the routes; src/http/routes.ts mounts this router at /api/themes.
const router = Router();

// W3-A: brand kit CRUD, mounted at /api/brand-kits.
export const brandKitsRouter = Router();

export default router;
