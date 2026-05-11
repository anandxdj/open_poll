import type { Request, Response, NextFunction } from 'express';
import { PollService } from './polls.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';

export class PollController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      // Mocking creatorId for now since Auth is deferred
      const creatorId = "mock-creator-id-123"; 
      
      const poll = await PollService.createPoll(req.body, creatorId);
      
      return ApiResponse.created(res, "Poll created successfully", poll);
    } catch (error) {
      next(error); // Sends error to your global errorHandler
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { pollId } = req.params;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const poll = await PollService.getPollById(String(pollId));
      return ApiResponse.ok(res, 'Poll fetched successfully', poll);
    } catch (error) {
      next(error);
    }
  }

  static async listByCreator(req: Request, res: Response, next: NextFunction) {
    try {
      const creatorId = String(req.query.creatorId || 'mock-creator-id-123');
      const polls = await PollService.listPollsByCreator(creatorId);
      return ApiResponse.ok(res, 'Polls fetched successfully', polls);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { pollId } = req.params;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const poll = await PollService.updatePoll(String(pollId), req.body);
      return ApiResponse.ok(res, 'Poll updated successfully', poll);
    } catch (error) {
      next(error);
    }
  }

  static async close(req: Request, res: Response, next: NextFunction) {
    try {
      const { pollId } = req.params;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const poll = await PollService.closePoll(String(pollId));
      return ApiResponse.ok(res, 'Poll closed successfully', poll);
    } catch (error) {
      next(error); // Sends error to your global errorHandler
    }
  }
}