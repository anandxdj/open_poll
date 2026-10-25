import { Router, type Request } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { BillingController } from './billing.controller';
import { checkoutSchema } from './billing.schema';
import './seatSync';

/**
 * Billing for the current workspace (X-Workspace-Id or the default), mounted
 * at /api/billing by src/http/routes.ts. Every route needs `workspace:billing`
 * (the owner). Without Stripe keys, checkout and portal answer 503
 * BILLING_DISABLED and GET reports `enabled: false`.
 */
const router = Router();

const byUser = (req: Request) => (req as AuthRequest).user?.id;
const readLimit = rateLimit({ prefix: 'billing-read', windowSec: 60, max: 60, keyBy: byUser });
// Each call can create Stripe objects: keep scripted bursts away from the API quota.
const actionLimit = rateLimit({ prefix: 'billing-action', windowSec: 3600, max: 30, keyBy: byUser });

router.get('/', authenticate(), readLimit, workspaceContext(), BillingController.overview);
router.post('/checkout', authenticate(), actionLimit, workspaceContext(), validate(checkoutSchema), BillingController.checkout);
router.post('/portal', authenticate(), actionLimit, workspaceContext(), BillingController.portal);

/**
 * Stripe webhook, mounted at /api/billing/webhook behind express.raw before
 * CORS and the JSON parsers (http/routes.ts), so `req.body` is the signed
 * Buffer. Authenticated by the signature, not a token. The limit is generous:
 * Stripe delivers from a few IPs and retries bursts after an outage.
 */
export const billingWebhookRouter = Router();
billingWebhookRouter.post(
  '/',
  rateLimit({ prefix: 'billing-webhook', windowSec: 60, max: 600 }),
  BillingController.webhook,
);

/** Public plan catalogue, mounted at /api/plans. */
export const plansRouter = Router();
plansRouter.get('/', rateLimit({ prefix: 'plans', windowSec: 60, max: 120 }), BillingController.plans);

export default router;
