import { Router } from 'express';

// W3-C (Billing and plan gates) adds the routes; src/http/routes.ts mounts this router at /api/billing.
const router = Router();

// W3-C: Stripe webhook, mounted at /api/billing/webhook behind express.raw so `req.body` is the signed Buffer.
export const billingWebhookRouter = Router();

// W3-C: public plan catalogue, mounted at /api/plans.
export const plansRouter = Router();

export default router;
