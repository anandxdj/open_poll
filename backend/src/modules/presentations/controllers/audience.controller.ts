import type { Request, Response, NextFunction } from 'express';
import { PresentationService, type HostCommandResult } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { WorkspaceRequest } from '../../../common/tenancy/workspaceContext.middleware';
import type { HostCommandResponse } from '../live/contract';
import { requireParam, requireUser } from './helpers';

/** The deck document plus the session the command acted on (as every host command answers). */
const commandResponse = ({ presentation, session }: HostCommandResult): HostCommandResponse => ({
  ...(presentation.toJSON() as Record<string, unknown>),
  session,
});

/** Audience pace (W2-F): the host opens and closes the slides; participants submit and retry attempts. */
export class PresentationAudienceController {
  static async openAudience(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const result = await PresentationService.openAudience(requireParam(req, 'id'), req, req.body ?? {});
      return ApiResponse.ok(res, 'Slides opened to the audience', commandResponse(result));
    } catch (error) {
      next(error);
    }
  }

  static async closeAudience(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const result = await PresentationService.closeAudience(requireParam(req, 'id'), req);
      return ApiResponse.ok(res, 'Slides closed', commandResponse(result));
    } catch (error) {
      next(error);
    }
  }

  static async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const view = await PresentationService.submitAudienceAttempt(requireParam(req, 'id'), req.body);
      return ApiResponse.ok(res, 'Attempt submitted', view);
    } catch (error) {
      next(error);
    }
  }

  static async retry(req: Request, res: Response, next: NextFunction) {
    try {
      const view = await PresentationService.retryAudienceAttempt(requireParam(req, 'id'), req.body);
      return ApiResponse.ok(res, 'New attempt started', view);
    } catch (error) {
      next(error);
    }
  }
}
