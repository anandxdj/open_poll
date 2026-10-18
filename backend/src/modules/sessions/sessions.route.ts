import { Router } from 'express';

// W2-C (Session history, reports, export, share) adds the routes; src/http/routes.ts mounts this router at /api/sessions.
const router = Router();

// W2-C: shared results by token, mounted at /api/public/results.
export const publicResultsRouter = Router();

export default router;
