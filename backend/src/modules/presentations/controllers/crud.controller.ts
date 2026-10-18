import type { Response, NextFunction } from 'express';
import { PresentationService } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { AuthRequest } from '../../auth/auth.middleware';
import { requireParam, requireUser } from './helpers';

export class PresentationCrudController {
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
}
