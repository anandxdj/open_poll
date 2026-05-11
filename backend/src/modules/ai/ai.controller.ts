import type { NextFunction, Request, Response } from 'express';
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

  static async generateAndSave(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = {
        ...req.body,
        creatorId: req.body.creatorId || 'mock-creator-id-123',
      };
      const result = await AiService.generateAndSavePoll(payload);
      return ApiResponse.created(res, 'AI poll generated and saved successfully', result);
    } catch (error) {
      next(error);
    }
  }
}
