import type { NextFunction, Response } from 'express';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { CreateFolderInput, MoveItemsInput, RenameFolderInput } from './folders.schema';
import { FoldersService, type FolderActor } from './folders.service';

function actorOf(req: WorkspaceRequest): FolderActor {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace || !req.membership) throw ApiError.internal('Workspace context is missing');
  return req as FolderActor;
}

const idParam = (req: WorkspaceRequest) => String(req.params.id ?? '');

export class FoldersController {
  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      return ApiResponse.ok(res, 'Folders fetched successfully', await FoldersService.list(actorOf(req)));
    } catch (error) {
      next(error);
    }
  }

  static async create(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const { name } = req.body as CreateFolderInput;
      const folder = await FoldersService.create(actorOf(req), name);
      void audit(req, 'folder.create', { type: 'folder', id: folder.id }, { name: folder.name });
      return ApiResponse.created(res, 'Folder created successfully', { folder });
    } catch (error) {
      next(error);
    }
  }

  static async rename(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const { name } = req.body as RenameFolderInput;
      const { folder, previousName } = await FoldersService.rename(actorOf(req), idParam(req), name);
      if (previousName !== folder.name) {
        void audit(req, 'folder.rename', { type: 'folder', id: folder.id }, { from: previousName, to: folder.name });
      }
      return ApiResponse.ok(res, 'Folder renamed successfully', { folder });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const result = await FoldersService.remove(actorOf(req), idParam(req));
      void audit(req, 'folder.delete', { type: 'folder', id: result.folder.id }, {
        name: result.folder.name,
        moved: result.moved,
        sharesRemoved: result.sharesRemoved,
      });
      return ApiResponse.ok(res, 'Folder deleted successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async move(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const result = await FoldersService.move(actorOf(req), req.body as MoveItemsInput);
      void audit(req, 'folder.move', result.folderId ? { type: 'folder', id: result.folderId } : null, {
        folderId: result.folderId,
        moved: result.moved,
      });
      return ApiResponse.ok(res, 'Items moved successfully', result);
    } catch (error) {
      next(error);
    }
  }
}
