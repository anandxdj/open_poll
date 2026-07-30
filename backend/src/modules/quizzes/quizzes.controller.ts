import type { Request, Response, NextFunction } from 'express';
import { QuizService } from './quizzes.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';

const requireUser = (req: AuthRequest) => {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  return req.user;
};

const requireParam = (req: Request, name: string) => {
  const value = req.params[name];
  if (!value) throw ApiError.badRequest(`${name} is required`);
  return String(value);
};

export class QuizController {
  // ---------- CRUD ----------

  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quiz = await QuizService.createQuiz(req.body, user.id);
      return ApiResponse.created(res, 'Quiz created successfully', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async listByCreator(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quizzes = await QuizService.listQuizzesByCreator(user.id);
      return ApiResponse.ok(res, 'Quizzes fetched successfully', quizzes);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quiz = await QuizService.assertOwnership(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Quiz fetched successfully', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quiz = await QuizService.updateQuiz(requireParam(req, 'id'), user.id, req.body);
      return ApiResponse.ok(res, 'Quiz updated successfully', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      await QuizService.deleteQuiz(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Quiz deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // ---------- Host controls ----------

  static async openLobby(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quiz = await QuizService.openLobby(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Lobby opened', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async advanceSlide(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const targetIndex = req.body?.slideIndex !== undefined ? Number(req.body.slideIndex) : undefined;
      const quiz = await QuizService.advanceSlide(requireParam(req, 'id'), user.id, targetIndex);
      return ApiResponse.ok(res, 'Slide advanced', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async reveal(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quiz = await QuizService.revealCurrentSlide(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Answers revealed', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async end(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const quiz = await QuizService.endQuiz(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Quiz ended', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async hostState(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = requireUser(req);
      const state = await QuizService.getHostState(requireParam(req, 'id'), user.id);
      return ApiResponse.ok(res, 'Host state fetched', state);
    } catch (error) {
      next(error);
    }
  }

  // ---------- Public participant flow ----------

  static async getByCode(req: Request, res: Response, next: NextFunction) {
    try {
      const quiz = await QuizService.getQuizByCode(requireParam(req, 'code'));
      return ApiResponse.ok(res, 'Quiz fetched', quiz);
    } catch (error) {
      next(error);
    }
  }

  static async join(req: Request, res: Response, next: NextFunction) {
    try {
      const participant = await QuizService.joinQuiz(requireParam(req, 'id'), req.body);
      return ApiResponse.ok(res, 'Joined quiz', participant);
    } catch (error) {
      next(error);
    }
  }

  static async answer(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await QuizService.submitAnswer(requireParam(req, 'id'), req.body);
      return ApiResponse.ok(res, 'Answer accepted', result);
    } catch (error) {
      next(error);
    }
  }

  static async participantState(req: Request, res: Response, next: NextFunction) {
    try {
      const participantId = String(req.query.participantId || '');
      const token = String(req.query.token || '');
      if (!participantId || !token) {
        throw ApiError.badRequest('participantId and token are required');
      }
      const state = await QuizService.getParticipantState(
        requireParam(req, 'id'),
        participantId,
        token
      );
      return ApiResponse.ok(res, 'Participant state fetched', state);
    } catch (error) {
      next(error);
    }
  }
}
