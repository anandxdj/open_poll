import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { requireFeature } from '../../common/plans/requireFeature';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { BrandKitsController, ThemesController } from './themes.controller';
import { createBrandKitSchema, updateBrandKitSchema } from './themes.schema';

/**
 * Themes and brand kits (W3-A). src/http/routes.ts mounts the default router
 * at /api/themes and `brandKitsRouter` at /api/brand-kits.
 *
 * - GET    /api/themes/presets      built-in themes as tokens, and the font choices (signed in)
 * - GET    /api/brand-kits          the workspace's kits (`deck:read`)
 * - GET    /api/brand-kits/:id
 * - POST   /api/brand-kits          create (`workspace:brand`), 400 LOW_CONTRAST, 409 BRAND_KIT_LIMIT
 * - PATCH  /api/brand-kits/:id      update (`workspace:brand`)
 * - DELETE /api/brand-kits/:id      delete; decks using it go back to their preset
 *
 * Every brand kit route needs the plan feature `brand_kits` (403 FEATURE_NOT_IN_PLAN).
 */
const router = Router();

router.get('/presets', authenticate(), ThemesController.presets);

export const brandKitsRouter = Router();

const writeLimit = rateLimit({
  prefix: 'brand-kits:write',
  windowSec: 60,
  max: 30,
  keyBy: (req) => (req as AuthRequest).user?.id,
});
const kits = [authenticate(), workspaceContext(), requireFeature('brand_kits')] as const;

brandKitsRouter.get('/', ...kits, BrandKitsController.list);
brandKitsRouter.post('/', ...kits, writeLimit, validate(createBrandKitSchema), BrandKitsController.create);
brandKitsRouter.get('/:id', ...kits, BrandKitsController.get);
brandKitsRouter.patch('/:id', ...kits, writeLimit, validate(updateBrandKitSchema), BrandKitsController.update);
brandKitsRouter.delete('/:id', ...kits, writeLimit, BrandKitsController.remove);

export default router;
