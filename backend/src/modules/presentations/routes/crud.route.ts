import { Router } from 'express';
import { PresentationCrudController } from '../controllers/crud.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../../auth/auth.middleware';
import { rateLimit } from '../../../common/middlewares/rateLimit.middleware';
import {
  createPresentationSchema,
  insertSlideSchema,
  patchSlideSchema,
  reorderSlidesSchema,
  updatePresentationSchema,
} from '../presentations.schema';

const router = Router();

// Creator CRUD, scoped to the request's workspace (policy `deck:*`).
router.post(
  '/',
  authenticate(),
  workspaceContext(),
  validate(createPresentationSchema),
  PresentationCrudController.create
);
router.get('/', authenticate(), workspaceContext(), PresentationCrudController.list);
router.get('/:id', authenticate(), workspaceContext(), PresentationCrudController.getById);
router.patch(
  '/:id',
  authenticate(),
  workspaceContext(),
  validate(updatePresentationSchema),
  PresentationCrudController.update
);
router.delete('/:id', authenticate(), workspaceContext(), PresentationCrudController.delete);
// Slide-level edits for co-editing (W3-B2): `If-Match: <revision>` → 409 DECK_CHANGED when stale.
router.post(
  '/:id/slides',
  authenticate(),
  workspaceContext(),
  validate(insertSlideSchema),
  PresentationCrudController.insertSlide
);
router.post(
  '/:id/slides/reorder',
  authenticate(),
  workspaceContext(),
  validate(reorderSlidesSchema),
  PresentationCrudController.reorderSlides
);
router.patch(
  '/:id/slides/:slideId',
  authenticate(),
  workspaceContext(),
  validate(patchSlideSchema),
  PresentationCrudController.updateSlide
);
router.delete('/:id/slides/:slideId', authenticate(), workspaceContext(), PresentationCrudController.deleteSlide);
// A copy writes a whole deck from a body-less request: per user, so one account cannot flood the collection.
router.post(
  '/:id/duplicate',
  authenticate(),
  rateLimit({ prefix: 'presentations:duplicate', windowSec: 60, max: 30, keyBy: (req) => (req as AuthRequest).user?.id }),
  workspaceContext(),
  PresentationCrudController.duplicate
);

export default router;
