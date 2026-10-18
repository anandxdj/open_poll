import { Router } from 'express';
import { PresentationCrudController } from '../controllers/crud.controller';
import { validate } from '../../../common/middlewares/validate.middleware';
import { authenticate } from '../../auth/auth.middleware';
import { createPresentationSchema, updatePresentationSchema } from '../presentations.schema';

const router = Router();

// Creator CRUD
router.post('/', authenticate(), validate(createPresentationSchema), PresentationCrudController.create);
router.get('/', authenticate(), PresentationCrudController.listByCreator);
router.get('/:id', authenticate(), PresentationCrudController.getById);
router.patch('/:id', authenticate(), validate(updatePresentationSchema), PresentationCrudController.update);
router.delete('/:id', authenticate(), PresentationCrudController.delete);

export default router;
