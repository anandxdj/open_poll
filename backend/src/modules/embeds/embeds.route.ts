import cors from 'cors';
import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { EmbedsController } from './embeds.controller';
import { createScreenTokenSchema } from './embeds.schema';

/**
 * W4-D: embeds, oEmbed and screens. Mounted at /api/embeds by src/http/routes.ts.
 *
 * Screen links, per deck, `deck:share` (authenticate → workspaceContext → policy):
 * - GET    /screen-tokens?presentationId   the deck's active screen links (never the tokens)
 * - POST   /screen-tokens                  {presentationId, label} → the token, shown once
 * - DELETE /screen-tokens/:id              revoke; connected screens leave the deck at once
 *
 * Public (allow-listed in the tenancy test; the credential is in the request):
 * - GET    /stage                          the stage-safe state of the deck whose screen token
 *                                          is in `X-Screen-Token` (404 dead link, 403 EMBED_DISABLED)
 * - GET    /policy?kind&id&token           may an embed page render, and which sites may frame
 *                                          it (the frontend proxy asks before serving /embed/*)
 */
const router = Router();

const tokenWrites = rateLimit({
  prefix: 'embeds:screen-tokens',
  windowSec: 60,
  max: 30,
  keyBy: (req) => (req as AuthRequest).user?.id,
});
// A room screen resyncs on every reconnect and slide change; a classroom NAT holds many.
const stageReads = rateLimit({ prefix: 'embeds:stage', windowSec: 60, max: 600 });
// The frontend proxy asks once per embed page view (cached briefly) from its own address.
const policyReads = rateLimit({ prefix: 'embeds:policy', windowSec: 60, max: 3000, onStoreError: 'memory' });

router.get('/screen-tokens', authenticate(), workspaceContext(), EmbedsController.listScreenTokens);
router.post(
  '/screen-tokens',
  authenticate(),
  workspaceContext(),
  tokenWrites,
  validate(createScreenTokenSchema),
  EmbedsController.createScreenToken,
);
router.delete('/screen-tokens/:id', authenticate(), workspaceContext(), tokenWrites, EmbedsController.revokeScreenToken);
router.get('/stage', stageReads, EmbedsController.stage);
router.get('/policy', policyReads, EmbedsController.policy);

/**
 * `GET /api/oembed?url=…&format=json[&maxwidth&maxheight]` — the oEmbed provider
 * endpoint (rich type, iframe HTML) for results, live and stage URLs of this
 * site. Public and cookie-free, so it answers any origin (`cors()` without
 * credentials); createApp() mounts it before the credentialed CORS allow-list
 * (see `mountPreParserRoutes`).
 */
export const oembedRouter = Router();

oembedRouter.use(cors());
oembedRouter.get('/', rateLimit({ prefix: 'oembed', windowSec: 60, max: 300 }), EmbedsController.oembed);

export default router;
