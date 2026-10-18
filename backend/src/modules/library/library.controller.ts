import type { NextFunction, Response } from 'express';
import type { z } from 'zod';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ConvertService } from './convert.service';
import { convertQuerySchema, libraryQuerySchema } from './library.schema';
import { LibraryService, type LibraryContext } from './library.service';

const libraryContext = (req: WorkspaceRequest): LibraryContext => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace) throw ApiError.internal('The library needs workspaceContext() mounted before it');
  return { user: req.user, workspace: req.workspace, membership: req.membership };
};

/** Express 5 exposes `req.query` read-only, so queries are parsed here rather than by validate(). */
function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw ApiError.badRequest(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return result.data;
}

export class LibraryController {
  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const page = await LibraryService.list(libraryContext(req), parseQuery(libraryQuerySchema, req.query));
      return ApiResponse.ok(res, 'Library fetched successfully', page);
    } catch (error) {
      next(error);
    }
  }

  static async convertPoll(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const { force } = parseQuery(convertQuerySchema, req.query);
      const pollId = String(req.params.pollId);
      const { created, presentation } = await ConvertService.convertPoll(libraryContext(req), pollId, { force });
      if (!created) return ApiResponse.ok(res, 'Poll already converted', { created, presentation });
      void audit(req, 'poll.convert', { type: 'presentation', id: presentation._id }, { pollId, force });
      return ApiResponse.created(res, 'Poll converted to a presentation', { created, presentation });
    } catch (error) {
      next(error);
    }
  }
}
