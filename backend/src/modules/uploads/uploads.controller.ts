import type { NextFunction, Response } from 'express';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { UploadsService, type UploadContext } from './uploads.service';

const uploadContext = (req: WorkspaceRequest): UploadContext => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace) throw ApiError.internal('Uploads need workspaceContext() mounted before them');
  return { user: req.user, workspace: req.workspace, membership: req.membership };
};

export class UploadsController {
  static async presign(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const upload = await UploadsService.presign(uploadContext(req), req.body);
      return ApiResponse.created(res, 'Upload URL created', upload);
    } catch (error) {
      next(error);
    }
  }

  static async complete(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const { asset, created } = await UploadsService.complete(uploadContext(req), req.body.key);
      if (!created) return ApiResponse.ok(res, 'Upload already completed', asset);
      void audit(req, 'media.upload', { type: 'media', id: asset._id }, { mime: asset.mime, bytes: asset.bytes, purpose: asset.purpose });
      return ApiResponse.created(res, 'Upload completed', asset);
    } catch (error) {
      next(error);
    }
  }
}
