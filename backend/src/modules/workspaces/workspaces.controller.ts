import type { NextFunction, Response } from 'express';
import { audit } from '../../common/audit/audit';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { AuthRequest } from '../auth/auth.middleware';
import type { IWorkspace } from './workspace.model';
import type { UpdateWorkspaceInput } from './workspaces.schema';
import { WorkspaceService, toWorkspaceDetail } from './workspaces.service';

function userIdOf(req: AuthRequest): string {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  return req.user.id;
}

function workspaceIdOf(req: AuthRequest): string {
  const workspaceId = req.params.id;
  if (!workspaceId) throw ApiError.badRequest('Workspace id is required');
  return String(workspaceId);
}

/** Audit source for an action on `workspace` (the path's workspace, not the X-Workspace-Id one). */
const auditSource = (req: AuthRequest, workspace: IWorkspace) => ({
  ip: req.ip,
  headers: req.headers,
  user: req.user,
  workspace,
});

export class WorkspacesController {
  static async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await WorkspaceService.listForUser(userIdOf(req));
      return ApiResponse.ok(res, 'Workspaces fetched successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const context = await WorkspaceService.create(userIdOf(req), req.body);
      void audit(auditSource(req, context.workspace), 'workspace.create', {
        type: 'workspace',
        id: context.workspace._id,
      });
      return ApiResponse.created(res, 'Workspace created successfully', toWorkspaceDetail(context));
    } catch (error) {
      next(error);
    }
  }

  static async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const actor = await WorkspaceService.resolve(userIdOf(req), workspaceIdOf(req));
      return ApiResponse.ok(res, 'Workspace fetched successfully', toWorkspaceDetail(actor));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const actor = await WorkspaceService.resolve(userIdOf(req), workspaceIdOf(req));
      const input: UpdateWorkspaceInput = req.body;
      const context = await WorkspaceService.update(actor, input);
      const fields = [
        ...(input.name !== undefined ? ['name'] : []),
        ...Object.keys(input.settings ?? {}).map((key) => `settings.${key}`),
      ];
      void audit(auditSource(req, context.workspace), 'workspace.update', { type: 'workspace', id: context.workspace._id }, { fields });
      return ApiResponse.ok(res, 'Workspace updated successfully', toWorkspaceDetail(context));
    } catch (error) {
      next(error);
    }
  }

  static async switch(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const actor = await WorkspaceService.resolve(userIdOf(req), workspaceIdOf(req));
      await WorkspaceService.switchDefault(actor);
      return ApiResponse.ok(res, 'Default workspace switched', toWorkspaceDetail(actor));
    } catch (error) {
      next(error);
    }
  }
}
