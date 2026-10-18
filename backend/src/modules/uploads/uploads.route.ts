import { Router } from 'express';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { completeUploadSchema, presignUploadSchema } from './uploads.schema';
import { UploadsController } from './uploads.controller';

/** Mounted at /api/uploads. Answers 503 STORAGE_DISABLED when S3_* is not configured. */
const router = Router();

// Per user, after authentication: one account cannot mint unlimited URLs from many IPs.
const uploadLimit = rateLimit({
  prefix: 'uploads',
  windowSec: 60,
  max: 30,
  keyBy: (req) => (req as AuthRequest).user?.id,
});

router.post(
  '/presign',
  authenticate(),
  uploadLimit,
  workspaceContext(),
  validate(presignUploadSchema),
  UploadsController.presign,
);
router.post(
  '/complete',
  authenticate(),
  uploadLimit,
  workspaceContext(),
  validate(completeUploadSchema),
  UploadsController.complete,
);

export default router;
