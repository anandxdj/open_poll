import { Router } from 'express';
import { rateLimit } from '../../common/middlewares/rateLimit.middleware';
import { validate } from '../../common/middlewares/validate.middleware';
import { workspaceContext } from '../../common/tenancy/workspaceContext.middleware';
import { authenticate } from '../auth/auth.middleware';
import { participantAuth, participantKey } from './participantAuth';
import { QnaController, QnaHostController } from './qna.controller';
import { askQuestionSchema, hostHighlightSchema, hostUpdateQuestionSchema } from './qna.schema';

/**
 * Participant Q&A, mounted by src/http/routes.ts at /api/presentations/:presentationId/qna.
 *
 * Every route needs the participant token (`participantAuth`). A coarse per-IP
 * budget, sized for classroom NAT like the answer route, runs first so token
 * guessing stays bounded; the real limits are per participant, keyed on the
 * verified identity, so one noisy phone cannot spend a whole room's budget.
 */
const router = Router({ mergeParams: true });

const perIp = rateLimit({ prefix: 'qna-ip', windowSec: 60, max: 2000 });
const perParticipant = (prefix: string, windowSec: number, max: number) =>
  rateLimit({ prefix, windowSec, max, keyBy: participantKey });

router.get('/', perIp, participantAuth(), perParticipant('qna-list', 60, 120), QnaController.list);
router.post(
  '/',
  perIp,
  participantAuth(),
  perParticipant('qna-ask', 60, 5),
  validate(askQuestionSchema),
  QnaController.ask
);
router.post('/:questionId/upvote', perIp, participantAuth(), perParticipant('qna-vote', 60, 60), QnaController.upvote);
router.delete(
  '/:questionId/upvote',
  perIp,
  participantAuth(),
  perParticipant('qna-vote', 60, 60),
  QnaController.removeUpvote
);

/**
 * Host moderation, mounted at /api/presentations/:presentationId/host/qna.
 * `authenticate()` + `workspaceContext()`, then `deck:host` on the deck (service).
 */
export const qnaHostRouter = Router({ mergeParams: true });

const perHost = rateLimit({
  prefix: 'qna-host',
  windowSec: 60,
  max: 600,
  keyBy: (req) => (req as { user?: { id: string } }).user?.id,
});

qnaHostRouter.get('/', authenticate(), workspaceContext(), perHost, QnaHostController.list);
qnaHostRouter.patch(
  '/:questionId',
  authenticate(),
  workspaceContext(),
  perHost,
  validate(hostUpdateQuestionSchema),
  QnaHostController.update
);
qnaHostRouter.post(
  '/:questionId/highlight',
  authenticate(),
  workspaceContext(),
  perHost,
  validate(hostHighlightSchema),
  QnaHostController.highlight
);

export default router;
