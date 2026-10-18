import { Router } from 'express';
import { PresentationHostController } from '../controllers/host.controller';
import { authenticate } from '../../auth/auth.middleware';

const router = Router();

// Host session controls
router.get('/:id/host/state', authenticate(), PresentationHostController.hostState);
router.post('/:id/host/open-lobby', authenticate(), PresentationHostController.openLobby);
router.post('/:id/host/advance', authenticate(), PresentationHostController.advanceSlide);
router.post('/:id/host/reveal', authenticate(), PresentationHostController.reveal);
router.post('/:id/host/end', authenticate(), PresentationHostController.end);

export default router;
