import type { Request, Response, NextFunction } from 'express';
import { PresentationService } from './presentations.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';

const requireUser = (req: AuthRequest) => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  return req.user;
};

const requireParam = (req: Request, name: string) => {
  const value = req.params[name];
  if (!value) throw ApiError.badRequest(`${name} is required`);
  return String(value);
};

export class PresentationController {
  // ---------- CRUD ----------

  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentation = await PresentationService.createPresentation(req.body, user.id);
      return ApiResponse.created(res, 'Presentation created successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async listByCreator(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentations = await PresentationService.listPresentationsByCreator(user.id);
      return ApiResponse.ok(res, 'Presentations fetched successfully', presentations);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentation = await PresentationService.assertOwnership(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Presentation fetched successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentation = await PresentationService.updatePresentation(requireParam(req, 'id'), user.id, req.body);
      return ApiResponse.ok(res, 'Presentation updated successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      await PresentationService.deletePresentation(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Presentation deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ---------- Host controls ----------

  static async openLobby(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentation = await PresentationService.openLobby(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Lobby opened', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async advanceSlide(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const targetIndex = req.body?.slideIndex !== undefined ? Number(req.body.slideIndex) : undefined;
      const presentation = await PresentationService.advanceSlide(requireParam(req, 'id'), user.id, targetIndex);
      return ApiResponse.ok(res, 'Slide advanced', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async reveal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentation = await PresentationService.revealCurrentSlide(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Answers revealed', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async end(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const presentation = await PresentationService.endPresentation(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Presentation ended', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async hostState(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const state = await PresentationService.getHostState(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Host state fetched', state);
    } catch (error) {
      next(error);
    }
  }

  // ---------- Public participant flow ----------

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
      const participantId = String(req.query.participantId || '');
      const token = String(req.query.token || '');
      if (!participantId || !token) {
        throw ApiError.badRequest('participantId and token are required');
      }
      const state = await PresentationService.getParticipantState(
        requireParam(req, 'id'),
        participantId,
        token
      );
      return ApiResponse.ok(res, 'Participant state fetched', state);
    } catch (error) {
      next(error);
    }
  }
}
