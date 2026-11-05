import type { Response, NextFunction } from 'express';
import { PresentationService } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import { audit } from '../../../common/audit/audit';
import type { WorkspaceRequest } from '../../../common/tenancy/workspaceContext.middleware';
import { requireParam, requireUser } from './helpers';
import { parseIfMatch } from '../revision';
import type { InsertSlideInput, PatchSlideInput, ReorderSlidesInput } from '../presentations.schema';
import type { IPresentation } from '../models/presentation.model';
import { resolveDeckTheme } from '../../themes/resolve';

/** The `If-Match` revision of the request (undefined: no check). */
const ifMatch = (req: WorkspaceRequest) => parseIfMatch(req.get('If-Match'));

/**
 * The deck plus its theme resolved (`themeTokens`: preset in its light or dark
 * mode, brand kit, overrides), so the builder draws its canvas and thumbnails
 * like the stage without knowing the presets.
 */
const withThemeTokens = async (presentation: IPresentation) => ({
  ...presentation.toJSON(),
  themeTokens: await resolveDeckTheme(presentation),
});

export class PresentationCrudController {
  static async create(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.createPresentation(req.body, req);
      return ApiResponse.created(res, 'Presentation created successfully', await withThemeTokens(presentation));
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
      return ApiResponse.ok(res, 'Presentation fetched successfully', await withThemeTokens(presentation));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.updatePresentation(requireParam(req, 'id'), req, req.body, {
        expectedRevision: ifMatch(req),
      });
      return ApiResponse.ok(res, 'Presentation updated successfully', await withThemeTokens(presentation));
    } catch (error) {
      next(error);
    }
  }

  // ---------- Slide-level edits (W3-B2): each answers with the whole deck and its new revision ----------

  static async insertSlide(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const { presentation, slideId } = await PresentationService.insertSlide(
        requireParam(req, 'id'),
        req,
        req.body as InsertSlideInput,
        ifMatch(req),
      );
      return ApiResponse.created(res, 'Slide added successfully', { ...presentation.toJSON(), slideId });
    } catch (error) {
      next(error);
    }
  }

  static async updateSlide(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.updateSlide(
        requireParam(req, 'id'),
        req,
        requireParam(req, 'slideId'),
        req.body as PatchSlideInput,
        ifMatch(req),
      );
      return ApiResponse.ok(res, 'Slide updated successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async deleteSlide(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.deleteSlide(
        requireParam(req, 'id'),
        req,
        requireParam(req, 'slideId'),
        ifMatch(req),
      );
      return ApiResponse.ok(res, 'Slide deleted successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async reorderSlides(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const presentation = await PresentationService.reorderSlides(
        requireParam(req, 'id'),
        req,
        req.body as ReorderSlidesInput,
        ifMatch(req),
      );
      return ApiResponse.ok(res, 'Slides reordered successfully', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async duplicate(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const sourceId = requireParam(req, 'id');
      const presentation = await PresentationService.duplicatePresentation(sourceId, req);
      void audit(req, 'presentation.duplicate', { type: 'presentation', id: presentation._id }, {
        sourceId,
        title: presentation.title,
      });
      return ApiResponse.created(res, 'Presentation duplicated successfully', await withThemeTokens(presentation));
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
