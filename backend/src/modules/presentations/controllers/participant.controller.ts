import type { Request, Response, NextFunction } from 'express';
import { PresentationService } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import { ApiError } from '../../../common/utils/ApiError';
import { requireParam } from './helpers';

/** `participantId` and `token` from the query string (participant reads). */
const participantCredentials = (req: Request) => {
  const participantId = String(req.query.participantId || '');
  const token = String(req.query.token || '');
  if (!participantId || !token) {
    throw ApiError.badRequest('participantId and token are required');
  }
  return { participantId, token };
};

export class PresentationParticipantController {
  static async getByCode(req: Request, res: Response, next: NextFunction) {
    try {
      const presentation = await PresentationService.getPresentationByCode(requireParam(req, 'code'));
      return ApiResponse.ok(res, 'Presentation fetched', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async join(req: Request, res: Response, next: NextFunction) {
    try {
      const participant = await PresentationService.joinPresentation(requireParam(req, 'id'), req.body);
      return ApiResponse.ok(res, 'Joined presentation', participant);
    } catch (error) {
      next(error);
    }
  }

  static async answer(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await PresentationService.submitAnswer(requireParam(req, 'id'), req.body);
      return ApiResponse.ok(res, 'Answer accepted', result);
    } catch (error) {
      next(error);
    }
  }

  static async participantState(req: Request, res: Response, next: NextFunction) {
    try {
      const { participantId, token } = participantCredentials(req);
      const state = await PresentationService.getParticipantState(requireParam(req, 'id'), participantId, token);
      return ApiResponse.ok(res, 'Participant state fetched', state);
    } catch (error) {
      next(error);
    }
  }

  static async liveState(req: Request, res: Response, next: NextFunction) {
    try {
      const { participantId, token } = participantCredentials(req);
      const state = await PresentationService.getParticipantLiveState(requireParam(req, 'id'), participantId, token);
      return ApiResponse.ok(res, 'Live state fetched', state);
    } catch (error) {
      next(error);
    }
  }
}
