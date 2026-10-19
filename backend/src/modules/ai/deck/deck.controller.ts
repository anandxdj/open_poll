import type { NextFunction, Response } from 'express';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { WorkspaceRequest } from '../../../common/tenancy/workspaceContext.middleware';
import { DeckService } from './deck.service';

/** `POST /api/ai/generate-deck`: 200 with an outline (`step: 'outline'`), 201 with the created deck. */
export const generateDeck = async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
  try {
    const result = await DeckService.generate(req, req.body);
    if (result.step === 'outline') return ApiResponse.ok(res, 'AI deck outline generated', result);
    return ApiResponse.created(res, 'AI deck generated', result);
  } catch (error) {
    next(error);
  }
};
