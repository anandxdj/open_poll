import { Router } from 'express';
import { authenticate, type AuthRequest } from '../auth/auth.middleware';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { LibraryController } from './library.controller';

/**
 * Mounted at /api/library by src/http/routes.ts.
 * - GET  /                        union of polls and decks as cards (cursor paginated)
 * - POST /convert/poll/:pollId    copy a poll's questions into an audience-paced deck
 */
const router = Router();

// Each conversion writes a deck; per user so one account cannot flood the collection.
const convertLimit = rateLimit({
  prefix: 'library:convert',
  windowSec: 60,
  max: 20,
  keyBy: (req) => (req as AuthRequest).user?.id,
});

router.get('/', authenticate(), workspaceContext(), LibraryController.list);
router.post('/convert/poll/:pollId', authenticate(), convertLimit, workspaceContext(), LibraryController.convertPoll);

export default router;
