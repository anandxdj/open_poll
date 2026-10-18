import { Router } from 'express';

// W4-D (Embeds, oEmbed, add-in panes) adds the routes; src/http/routes.ts mounts this router at /api/embeds.
const router = Router();

// W4-D: oEmbed provider endpoint, mounted at /api/oembed.
export const oembedRouter = Router();

export default router;
