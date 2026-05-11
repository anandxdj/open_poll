import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ResponseService } from './responses.service';

export class ResponsesController {
  static async submit(req: Request, res: Response, next: NextFunction) {
    try {
      const response = await ResponseService.submitResponse(req.body);
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
}
