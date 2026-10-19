import type { NextFunction, Response } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import type { ParticipantRequest } from './participantAuth';
import { hostListStatusSchema } from './qna.schema';
import * as qna from './qna.service';

const param = (req: { params: Record<string, unknown> }, name: string) => {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw ApiError.badRequest(`${name} is required`);
  return value;
};

const participantOf = (req: ParticipantRequest) => {
  if (!req.participant) throw ApiError.unauthorized('Join the presentation first');
  return req.participant;
};

type Handler<R> = (req: R, res: Response) => Promise<unknown>;

const handle =
  <R>(fn: Handler<R>) =>
  async (req: R, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

export const QnaController = {
  ask: handle<ParticipantRequest>(async (req, res) => {
    const question = await qna.askQuestion(param(req, 'presentationId'), participantOf(req), req.body);
    return ApiResponse.created(res, 'Question received', question);
  }),

  list: handle<ParticipantRequest>(async (req, res) => {
    const list = await qna.listForParticipant(param(req, 'presentationId'), participantOf(req));
    return ApiResponse.ok(res, 'Questions fetched', list);
  }),

  upvote: handle<ParticipantRequest>(async (req, res) => {
    const result = await qna.setUpvote(param(req, 'presentationId'), participantOf(req), param(req, 'questionId'), true);
    return ApiResponse.ok(res, 'Upvoted', result);
  }),

  removeUpvote: handle<ParticipantRequest>(async (req, res) => {
    const result = await qna.setUpvote(param(req, 'presentationId'), participantOf(req), param(req, 'questionId'), false);
    return ApiResponse.ok(res, 'Upvote removed', result);
  }),
};

export const QnaHostController = {
  list: handle<WorkspaceRequest>(async (req, res) => {
    const parsed = hostListStatusSchema.safeParse(req.query.status ?? undefined);
    if (!parsed.success) throw ApiError.badRequest('status must be a question status or "all"');
    const list = await qna.listForHost(param(req, 'presentationId'), req, parsed.data);
    return ApiResponse.ok(res, 'Questions fetched', list);
  }),

  update: handle<WorkspaceRequest>(async (req, res) => {
    const question = await qna.updateForHost(param(req, 'presentationId'), req, param(req, 'questionId'), req.body);
    return ApiResponse.ok(res, 'Question updated', question);
  }),

  highlight: handle<WorkspaceRequest>(async (req, res) => {
    const question = await qna.highlightForHost(
      param(req, 'presentationId'),
      req,
      param(req, 'questionId'),
      req.body.highlighted
    );
    return ApiResponse.ok(res, question.highlighted ? 'Question highlighted' : 'Highlight cleared', question);
  }),
};
