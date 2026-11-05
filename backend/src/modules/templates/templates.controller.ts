import type { NextFunction, Response } from 'express';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { SaveTemplateInput, UseTemplateInput } from './templates.schema';
import { TemplatesService, type TemplateActor } from './templates.service';

function actorOf(req: WorkspaceRequest): TemplateActor {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace || !req.membership) throw ApiError.internal('Workspace context is missing');
  return req as TemplateActor;
}

const idParam = (req: WorkspaceRequest) => String(req.params.id ?? '');

export class TemplatesController {
  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      return ApiResponse.ok(res, 'Templates fetched successfully', await TemplatesService.list(actorOf(req)));
    } catch (error) {
      next(error);
    }
  }

  static async save(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const { presentationId, title } = req.body as SaveTemplateInput;
      const template = await TemplatesService.saveAsTemplate(actorOf(req), presentationId, title);
      void audit(req, 'template.create', { type: 'presentation', id: template._id }, {
        sourceId: presentationId,
        title: template.title,
      });
      return ApiResponse.created(res, 'Template saved successfully', template);
    } catch (error) {
      next(error);
    }
  }

  static async use(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const templateId = idParam(req);
      const { title } = (req.body ?? {}) as UseTemplateInput;
      const presentation = await TemplatesService.use(actorOf(req), templateId, title);
      void audit(req, 'template.use', { type: 'presentation', id: presentation._id }, { templateId, title: presentation.title });
      return ApiResponse.created(res, 'Deck created from template', presentation);
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const removed = await TemplatesService.remove(actorOf(req), idParam(req));
      void audit(req, 'template.delete', { type: 'presentation', id: removed.id }, { title: removed.title });
      return ApiResponse.ok(res, 'Template deleted successfully', removed);
    } catch (error) {
      next(error);
    }
  }
}
