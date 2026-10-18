import type { NextFunction, Request, Response } from 'express';
import type { AuthRequest } from '../auth/auth.middleware';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { AiService } from './ai.service';

export class AiController {
  static async generateDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const draft = await AiService.generatePollDraft(req.body);
      return ApiResponse.ok(res, 'AI poll draft generated successfully', draft);
    } catch (error) {
      next(error);
    }
  }

  static async generateAndSave(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // The route requires auth; the owner is never taken from the body.
      const payload = { ...req.body, creatorId: req.user!.id };
      const result = await AiService.generateAndSavePoll(payload);
      return ApiResponse.created(res, 'AI poll generated and saved successfully', result);
    } catch (error) {
      next(error);
    }
  }

  static async generateQuizDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const draft = await AiService.generateQuizDraft(req.body);
      return ApiResponse.ok(res, 'AI quiz draft generated successfully', draft);
    } catch (error) {
      next(error);
    }
  }
}
