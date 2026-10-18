import type { Response, NextFunction } from 'express';
import { PresentationService } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { AuthRequest } from '../../auth/auth.middleware';
import { requireParam, requireUser } from './helpers';

export class PresentationHostController {
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
}
