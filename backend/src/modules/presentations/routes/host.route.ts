import { Router } from 'express';
import { PresentationHostController } from '../controllers/host.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../../common/tenancy/workspaceContext.middleware';
import { authenticate } from '../../auth/auth.middleware';
import { advanceSlideSchema, gotoSlideSchema } from '../presentations.schema';

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
router.get('/:id/sessions', authenticate(), workspaceContext(), PresentationHostController.sessions);

export default router;
