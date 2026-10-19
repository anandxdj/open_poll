import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/ApiError';
import { assertCan, can, type PolicyContext } from '../../common/tenancy/policy';
import type { Action } from '../../common/tenancy/roles';
import { PresentationModel, type IPresentation } from '../presentations/models/presentation.model';
import { PresentationSessionModel, type IPresentationSession } from '../presentations/models/session.model';

/**
 * Sessions are authorized through their deck: the policy resource is the
 * deck (its `workspaceId`, or `creatorId` for decks from before workspaces),
 * so moving rights on a deck moves them on its runs too.
 */

export interface AuthorizedSession {
  session: IPresentationSession;
  presentation: IPresentation;
}

const sessionNotFound = () => ApiError.notFound('Session not found');

/** The session and its (non-trashed) deck, or 404. */
export const loadSession = async (sessionId: string): Promise<AuthorizedSession> => {
  if (!mongoose.isValidObjectId(sessionId)) throw sessionNotFound();
  const session = await PresentationSessionModel.findById(sessionId);
  if (!session) throw sessionNotFound();
  const presentation = await PresentationModel.findById(session.presentationId);
  if (!presentation || presentation.deletedAt) throw sessionNotFound();
  return { session, presentation };
};

/** Loads the session and checks `action` on its deck (401/403 from the policy, 404 when missing). */
export const authorizeSession = async (
  sessionId: string,
  ctx: PolicyContext,
  action: Action
): Promise<AuthorizedSession> => {
  const found = await loadSession(sessionId);
  assertCan(ctx, action, found.presentation);
  return found;
};

/** Non-throwing check of a further action on an already-authorized session. */
export const canOnSession = (ctx: PolicyContext, action: Action, presentation: IPresentation) =>
  can(ctx, action, presentation);
