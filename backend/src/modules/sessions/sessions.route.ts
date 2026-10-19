import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { requireFeature } from '../../common/plans/requireFeature';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { SessionsController } from './sessions.controller';
import { shareSchema } from './sessions.schema';

/**
 * Mounted at /api/sessions by src/http/routes.ts. Host routes run
 * authenticate() → workspaceContext() → the session's deck policy
 * (`session:read|export|share`, `deck:delete`).
 *
 * - GET    /?presentationId&cursor&limit   a deck's sessions, newest first
 * - GET    /:sessionId                     report
 * - GET    /:sessionId/export.csv          CSV (every plan)
 * - GET    /:sessionId/export.xlsx         XLSX (plan feature `export_xlsx`)
 * - GET    /:sessionId/export.pdf          PDF (plan feature `export_pdf`)
 * - POST   /:sessionId/share               enable / update the public results link
 * - DELETE /:sessionId/share               disable it
 * - DELETE /:sessionId                     delete the session and its data
 * - GET    /:sessionId/me?participantId&token   participant take-home (participant token, no account)
 */
const router = Router();

const perUser = (prefix: string, max: number) =>
  rateLimit({ prefix, windowSec: 60, max, keyBy: (req) => (req as AuthRequest).user?.id });

// Exports read a whole session: per user, so one account cannot hammer the database.
const exportLimit = perUser('sessions:export', 30);
const shareLimit = perUser('sessions:share', 30);

router.get('/', authenticate(), workspaceContext(), SessionsController.list);
// Participant take-home: per IP and sized for classroom NAT (everyone opens it at the end).
router.get('/:sessionId/me', rateLimit({ prefix: 'sessions:me', windowSec: 60, max: 600 }), SessionsController.takeHome);
router.get(
  '/:sessionId/export.csv',
  authenticate(),
  workspaceContext(),
  exportLimit,
  requireFeature('export_csv'),
  SessionsController.exportCsv
);
router.get(
  '/:sessionId/export.xlsx',
  authenticate(),
  workspaceContext(),
  exportLimit,
  requireFeature('export_xlsx'),
  SessionsController.exportXlsx
);
router.get(
  '/:sessionId/export.pdf',
  authenticate(),
  workspaceContext(),
  exportLimit,
  requireFeature('export_pdf'),
  SessionsController.exportPdf
);
router.post(
  '/:sessionId/share',
  authenticate(),
  workspaceContext(),
  shareLimit,
  validate(shareSchema),
  SessionsController.share
);
router.delete('/:sessionId/share', authenticate(), workspaceContext(), shareLimit, SessionsController.unshare);
router.get('/:sessionId', authenticate(), workspaceContext(), SessionsController.report);
router.delete('/:sessionId', authenticate(), workspaceContext(), SessionsController.remove);

/**
 * Mounted at /api/public/results: a shared session's aggregated results by
 * token, no account. Per IP; the 192-bit token cannot be enumerated, the
 * limit protects the database.
 */
export const publicResultsRouter = Router();

publicResultsRouter.get(
  '/:token',
  rateLimit({ prefix: 'public-results', windowSec: 60, max: 300 }),
  SessionsController.publicResults
);

export default router;
