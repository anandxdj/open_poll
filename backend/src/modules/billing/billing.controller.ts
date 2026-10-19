import type { NextFunction, Request, Response } from 'express';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import {
  createCheckoutSession,
  createPortalSession,
  getBillingOverview,
  type BillingActor,
} from './billing.service';
import type { CheckoutInput } from './billing.schema';
import { getPlanCatalog } from './plansCatalog';
import { requireBilling } from './stripe';
import { processStripeEvent, verifyStripeEvent } from './webhook.service';

function actorOf(req: WorkspaceRequest): BillingActor {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace || !req.membership) throw ApiError.internal('workspaceContext() must run before the billing routes');
  return { user: req.user, workspace: req.workspace, membership: req.membership };
}

export class BillingController {
  static async overview(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      return ApiResponse.ok(res, 'Billing fetched successfully', await getBillingOverview(actorOf(req)));
    } catch (error) {
      next(error);
    }
  }

  static async checkout(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const actor = actorOf(req);
      const input: CheckoutInput = req.body;
      const result = await createCheckoutSession(actor, input);
      void audit(req, 'billing.checkout.start', { type: 'workspace', id: actor.workspace._id }, {
        plan: input.plan,
        interval: input.interval,
        quantity: result.quantity,
        sessionId: result.sessionId,
      });
      return ApiResponse.ok(res, 'Checkout session created', { url: result.url });
    } catch (error) {
      next(error);
    }
  }

  static async portal(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const actor = actorOf(req);
      const result = await createPortalSession(actor);
      void audit(req, 'billing.portal.open', { type: 'workspace', id: actor.workspace._id });
      return ApiResponse.ok(res, 'Billing portal session created', result);
    } catch (error) {
      next(error);
    }
  }

  static async plans(_req: Request, res: Response, next: NextFunction) {
    try {
      const catalog = await getPlanCatalog();
      // Prices are cached server-side for minutes; let browsers and CDNs keep the page briefly too.
      res.set('Cache-Control', 'public, max-age=60');
      return ApiResponse.ok(res, 'Plans fetched successfully', catalog);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Stripe webhook. `req.body` is the raw Buffer (express.raw mount). Answers
   * 200 only once the event is processed (or was already), 409 while another
   * delivery holds it, 5xx when a handler fails: Stripe retries all three.
   */
  static async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      const runtime = requireBilling();
      const event = await verifyStripeEvent(runtime, req.body, req.get('stripe-signature'));
      const outcome = await processStripeEvent(runtime, event);
      if (outcome === 'in_progress') {
        throw new ApiError(409, 'This event is being processed by another delivery', 'WEBHOOK_IN_PROGRESS');
      }
      return ApiResponse.ok(res, 'Webhook received', { received: true, outcome });
    } catch (error) {
      next(error);
    }
  }
}
