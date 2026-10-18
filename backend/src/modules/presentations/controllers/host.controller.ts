import type { Response, NextFunction } from 'express';
import { PresentationService, type HostCommandResult } from '../presentations.service';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { WorkspaceRequest } from '../../../common/tenancy/workspaceContext.middleware';
import type { HostCommandResponse } from '../live/contract';
import { requireParam, requireUser } from './helpers';

/** The deck document as before, plus the session the command acted on. */
const commandResponse = ({ presentation, session }: HostCommandResult): HostCommandResponse => ({
  ...(presentation.toJSON() as Record<string, unknown>),
  session,
});

type Command = (presentationId: string, req: WorkspaceRequest) => Promise<HostCommandResult>;

/** One handler per host command: auth, run, respond with `HostCommandResponse`. */
const command =
  (message: string, run: Command) => async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      requireUser(req);
      const result = await run(requireParam(req, 'id'), req);
      return ApiResponse.ok(res, message, commandResponse(result));
    } catch (error) {
      next(error);
    }
  };

export class PresentationHostController {
  static openLobby = command('Lobby opened', (id, req) => PresentationService.openLobby(id, req));

  static start = command('Session started', (id, req) => PresentationService.startSession(id, req));

  static goto = command('Slide shown', (id, req) => PresentationService.gotoSlide(id, req, req.body));

  static advanceSlide = command('Slide advanced', (id, req) =>
    PresentationService.advanceSlide(id, req, req.body?.slideIndex)
  );

  static close = command('Answers closed', (id, req) => PresentationService.closeCurrentSlide(id, req));

  static reopen = command('Answers reopened', (id, req) => PresentationService.reopenCurrentSlide(id, req));

  static reveal = command('Answers revealed', (id, req) => PresentationService.revealCurrentSlide(id, req));

  static end = command('Presentation ended', (id, req) => PresentationService.endPresentation(id, req));

  static async hostState(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const state = await PresentationService.getHostState(requireParam(req, 'id'), req);
      return ApiResponse.ok(res, 'Host state fetched', state);
    } catch (error) {
      next(error);
    }
  }

  static async sessions(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      requireUser(req);
      const sessions = await PresentationService.listSessions(requireParam(req, 'id'), req);
      return ApiResponse.ok(res, 'Sessions fetched', sessions);
    } catch (error) {
      next(error);
    }
  }
}
