import type { NextFunction, Response } from 'express';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { actorOf, parseQuery } from './members.controller';
import { shareQuerySchema, type PutSharesInput } from './members.schema';
import { SharingService } from './sharing.service';

export class SharingController {
  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const query = parseQuery(shareQuerySchema, req.query);
      return ApiResponse.ok(res, 'Shares fetched successfully', await SharingService.list(actorOf(req), query));
    } catch (error) {
      next(error);
    }
  }

  static async replace(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const query = parseQuery(shareQuerySchema, req.query);
      const { list, changes } = await SharingService.replace(actorOf(req), query, req.body as PutSharesInput);
      for (const change of changes) {
        void audit(req, `share.${change.kind}`, { type: query.resourceType, id: query.resourceId }, {
          principalType: change.principalType,
          principalId: change.principalId,
          role: change.role,
          previousRole: change.previousRole,
          title: list.resource.title,
        });
      }
      return ApiResponse.ok(res, 'Shares updated successfully', list);
    } catch (error) {
      next(error);
    }
  }
}
