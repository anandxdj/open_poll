import type { Response, NextFunction } from 'express';
import { PresentationService } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { WorkspaceRequest } from '../../../common/tenancy/workspaceContext.middleware';
import { requireParam, requireUser } from './helpers';

export class PresentationCrudController {
  static async create(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.createPresentation(req.body, req);
      return ApiResponse.created(res, 'Presentation created successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentations = await PresentationService.listPresentations(req);
      return ApiResponse.ok(res, 'Presentations fetched successfully', presentations);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.getPresentationFor(requireParam(req, 'id'), req);
      return ApiResponse.ok(res, 'Presentation fetched successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.updatePresentation(requireParam(req, 'id'), req, req.body);
      return ApiResponse.ok(res, 'Presentation updated successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      await PresentationService.deletePresentation(requireParam(req, 'id'), req);
      return ApiResponse.ok(res, 'Presentation deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}
