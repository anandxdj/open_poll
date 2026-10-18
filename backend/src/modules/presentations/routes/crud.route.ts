import { Router } from 'express';
import { PresentationCrudController } from '../controllers/crud.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../../common/tenancy/workspaceContext.middleware';
import { authenticate } from '../../auth/auth.middleware';
import { createPresentationSchema, updatePresentationSchema } from '../presentations.schema';

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

export default router;
