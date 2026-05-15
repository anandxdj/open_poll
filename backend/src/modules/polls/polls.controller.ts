import type { Request, Response, NextFunction } from 'express';
import { PollService } from './polls.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';

export class PollController {
  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const creatorId = req.user.id; 
      
      const poll = await PollService.createPoll(req.body, creatorId);
      
      return ApiResponse.created(res, "Poll created successfully", poll);
    } catch (error) {
      next(error); // Sends error to your global errorHandler
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      const poll = await PollService.getPollById(String(pollId));
      return ApiResponse.ok(res, 'Poll fetched successfully', poll);
    } catch (error) {
      next(error);
    }
  }

  static async listByCreator(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const creatorId = req.user.id;
      const polls = await PollService.listPollsByCreator(creatorId);
      return ApiResponse.ok(res, 'Polls fetched successfully', polls);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { pollId } = req.params;
      if (!pollId) throw ApiError.badRequest('pollId is required');
      
      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to update this poll');
      }

      const updatedPoll = await PollService.updatePoll(String(pollId), req.body);
      return ApiResponse.ok(res, 'Poll updated successfully', updatedPoll);
    } catch (error) {
      next(error);
    }
  }

  static async close(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to close this poll');
      }

      const closedPoll = await PollService.closePoll(String(pollId));
      return ApiResponse.ok(res, 'Poll closed successfully', closedPoll);
    } catch (error) {
      next(error); // Sends error to your global errorHandler
    }
  }

  static async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to delete this poll');
      }

      await PollService.deletePoll(String(pollId));
      return ApiResponse.ok(res, 'Poll deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async publishResults(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const pollId = req.params.pollId || req.params.id;
      if (!pollId) throw ApiError.badRequest('pollId is required');

      const poll = await PollService.getPollById(String(pollId));
      if (!req.user || poll.creatorId !== req.user.id) {
        throw ApiError.forbidden('You do not have permission to publish results for this poll');
      }

      const publishedPoll = await PollService.publishResults(String(pollId));
      return ApiResponse.ok(res, 'Poll results published successfully', publishedPoll);
    } catch (error) {
      next(error);
    }
  }
}