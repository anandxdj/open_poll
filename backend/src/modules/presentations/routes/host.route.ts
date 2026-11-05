import { Router } from 'express';
import { PresentationHostController } from '../controllers/host.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../../common/tenancy/workspaceContext.middleware';
import { authenticate } from '../../auth/auth.middleware';
import { rateLimit } from '../../../common/middlewares/rateLimit.middleware';
import { advanceSlideSchema, gotoSlideSchema, timerCommandSchema } from '../presentations.schema';
// Registers the job that ends idle lobbies and presented sessions.
import '../live/idleSessions';

const router = Router();

// Host session controls (policy `deck:host`; the session list needs `session:read`).
router.get('/:id/host/state', authenticate(), workspaceContext(), PresentationHostController.hostState);
router.post('/:id/host/open-lobby', authenticate(), workspaceContext(), PresentationHostController.openLobby);
router.post('/:id/host/start', authenticate(), workspaceContext(), PresentationHostController.start);
router.post(
  '/:id/host/goto',
  authenticate(),
  workspaceContext(),
  validate(gotoSlideSchema),
  PresentationHostController.goto
);
router.post(
  '/:id/host/advance',
  authenticate(),
  workspaceContext(),
  validate(advanceSlideSchema),
  PresentationHostController.advanceSlide
);
router.post('/:id/host/close', authenticate(), workspaceContext(), PresentationHostController.close);
router.post('/:id/host/reopen', authenticate(), workspaceContext(), PresentationHostController.reopen);
router.post('/:id/host/reveal', authenticate(), workspaceContext(), PresentationHostController.reveal);
router.post('/:id/host/end', authenticate(), workspaceContext(), PresentationHostController.end);

// Presenter tools (W2-A): the current slide's timer, removing participants, the phone remote.
router.post(
  '/:id/host/timer',
  authenticate(),
  workspaceContext(),
  validate(timerCommandSchema),
  PresentationHostController.timer
);
router.post('/:id/host/skip', authenticate(), workspaceContext(), PresentationHostController.skip);
router.post(
  '/:id/host/participants/:participantId/kick',
  authenticate(),
  workspaceContext(),
  PresentationHostController.kick
);
const remoteTokenLimit = rateLimit({ prefix: 'remote-token', windowSec: 60, max: 20 });
router.get('/:id/host/remote-token', authenticate(), workspaceContext(), PresentationHostController.remoteStatus);
router.post(
  '/:id/host/remote-token',
  remoteTokenLimit,
  authenticate(),
  workspaceContext(),
  PresentationHostController.createRemoteToken
);
router.delete(
  '/:id/host/remote-token',
  remoteTokenLimit,
  authenticate(),
  workspaceContext(),
  PresentationHostController.revokeRemoteToken
);
router.get('/:id/sessions', authenticate(), workspaceContext(), PresentationHostController.sessions);

export default router;
