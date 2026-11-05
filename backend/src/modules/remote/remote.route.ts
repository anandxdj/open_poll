import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { RemoteService } from './remote.service';

/**
 * Mounted at /api/remote (src/http/routes.ts). Public: the pairing token in the
 * path plus the device key in `X-Remote-Device` are the credential (no user
 * session, no workspace header). The first device to call binds the pairing;
 * the host's own routes live under /api/presentations/:id/host/remote-token.
 */
const router = Router();

/** Header carrying the phone's device key (random, kept in its localStorage). */
export const REMOTE_DEVICE_HEADER = 'x-remote-device';

router.get(
  '/:token/state',
  rateLimit({ prefix: 'remote-state', windowSec: 60, max: 120 }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pairing = await RemoteService.redeem(req.params.token, req.get(REMOTE_DEVICE_HEADER));
      const state = await RemoteService.state(String(pairing.presentationId));
      return ApiResponse.ok(res, 'Remote state fetched', state);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
