import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { verifyParticipant } from '../presentations/live/participant.service';
import { QNA_ERROR_CODES } from './qna.contract';
import type { QnaParticipant } from './qna.service';

/** Headers carrying the credentials `POST /api/presentations/:id/join` returned. */
export const PARTICIPANT_ID_HEADER = 'X-Participant-Id';
export const PARTICIPANT_TOKEN_HEADER = 'X-Participant-Token';

export interface ParticipantRequest extends Request {
  participant?: QnaParticipant;
}

/**
 * Participant routes: the identity is the participant whose secret token the
 * request presents (headers, so it stays out of URLs and logs), checked
 * against the live session like the answer path. Nothing in the body or the
 * query names the participant. Sets `req.participant = {id, sessionId}`.
 */
export const participantAuth = () => async (req: ParticipantRequest, _res: Response, next: NextFunction) => {
  try {
    const participantId = req.get(PARTICIPANT_ID_HEADER)?.trim();
    const token = req.get(PARTICIPANT_TOKEN_HEADER)?.trim();
    if (!participantId || !token) {
      throw new ApiError(401, 'Join the presentation first', QNA_ERROR_CODES.participantRequired);
    }
    const presentationId = String(req.params.presentationId ?? '');
    const { sessionId } = await verifyParticipant(presentationId, participantId, token);
    req.participant = { id: participantId, sessionId };
    next();
  } catch (error) {
    next(error);
  }
};

/** Rate-limit key: the verified participant (falls back to the IP before auth ran). */
export const participantKey = (req: Request) => (req as ParticipantRequest).participant?.id;
