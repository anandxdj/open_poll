import type { NextFunction, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { insightsQuerySchema } from './insights.schema';
import { InsightsService, type InsightsContext } from './insights.service';

export const InsightsController = {
  get: async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      let query;
      try {
        query = insightsQuerySchema.parse(req.query);
      } catch (error) {
        if (error instanceof ZodError) {
          throw ApiError.badRequest(error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
        }
        throw error;
      }
      // workspaceContext() ran first, so the workspace and user are present.
      ApiResponse.ok(res, 'Insights fetched', await InsightsService.get(req as InsightsContext & WorkspaceRequest, query));
    } catch (error) {
      next(error);
    }
  },
};
