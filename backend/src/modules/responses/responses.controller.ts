import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ResponseService } from './responses.service';

export class ResponsesController {
  static async issueBallot(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const ballot = await ResponseService.issueBallot(String(pollId));
      return ApiResponse.ok(res, 'Ballot issued', ballot);
    } catch (error) {
      next(error);
    }
  }

  static async issueGuestToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = ResponseService.issueGuestIdentity(req.body);
      return ApiResponse.ok(res, 'Guest token issued', token);
    } catch (error) {
      next(error);
    }
  }

  static async submit(req: Request, res: Response, next: NextFunction) {
    try {
      // Identity comes only from the verified session — never from the body.
      const response = await ResponseService.submitResponse(req.body, {
        userId: (req as any).user?.id,
        clientIp: req.ip,
      });
      return ApiResponse.created(res, 'Response submitted successfully', response);
    } catch (error) {
      next(error);
    }
  }

  static async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const summary = await ResponseService.getPollAnalytics(String(pollId));
      return ApiResponse.ok(res, 'Poll analytics fetched successfully', summary);
    } catch (error) {
      next(error);
    }
  }

  static async getResponsesList(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId;
      const userId = (req as any).user?.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      if (!userId) throw ApiError.unauthorized('Not authenticated');

      const list = await ResponseService.getPollResponsesList(String(pollId), userId);
      return ApiResponse.ok(res, 'Poll responses list fetched successfully', list);
    } catch (error) {
      next(error);
    }
  }
}
