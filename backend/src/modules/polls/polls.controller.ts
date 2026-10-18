import type { Response, NextFunction } from 'express';
import { PollService } from './polls.service';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import { assertCan, can, type PolicyContext } from '../../common/tenancy/policy';
import type { Action } from '../../common/tenancy/roles';
import {
  WORKSPACE_HEADER,
  resolveWorkspaceContext,
  type WorkspaceRequest,
} from '../../common/tenancy/workspaceContext.middleware';

function pollIdOf(req: WorkspaceRequest): string {
  const pollId = req.params.pollId || req.params.id;
  if (!pollId) throw ApiError.badRequest('pollId is required');
  return String(pollId);
}

/** Loads the poll and checks the caller may perform `action` on it in the current workspace. */
async function authorizedPoll(req: WorkspaceRequest, action: Action) {
  const poll = await PollService.getPollById(pollIdOf(req));
  assertCan(req, action, poll);
  return poll;
}

/**
 * Policy context for the public read, where sign-in is optional: the signed-in
 * user in their selected workspace, or just the user (enough for polls from
 * before migration 020) when that workspace is not usable, or nobody.
 */
async function readerContext(req: WorkspaceRequest): Promise<PolicyContext> {
  if (!req.user) return {};
  try {
    const requested = req.get(WORKSPACE_HEADER)?.trim();
    return { user: req.user, ...(await resolveWorkspaceContext(req.user.id, requested || undefined)) };
  } catch {
    // A stale X-Workspace-Id must not break a public poll page.
    return { user: req.user };
  }
}

export class PollController {
  static async create(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      assertCan(req, 'deck:create');
      const poll = await PollService.createPoll(req.body, req.user!.id, req.workspace!._id);

      return ApiResponse.created(res, "Poll created successfully", poll);
    } catch (error) {
      next(error); // Sends error to your global errorHandler
    }
  }

  static async getById(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const poll = await PollService.getPollById(pollIdOf(req));

      // Unpublished drafts are private to their workspace: pretend they don't
      // exist for anyone else so poll ids can't be enumerated.
      if (!poll.isPublished && !can(await readerContext(req), 'deck:read', poll)) {
        throw ApiError.notFound('Poll not found');
      }

      return ApiResponse.ok(res, 'Poll fetched successfully', poll);
    } catch (error) {
      next(error);
    }
  }

  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      assertCan(req, 'deck:read');
      const polls = await PollService.listPolls({ userId: req.user!.id, workspace: req.workspace! });
      return ApiResponse.ok(res, 'Polls fetched successfully', polls);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const poll = await authorizedPoll(req, 'deck:edit');
      const updatedPoll = await PollService.updatePoll(String(poll._id), req.body);
      return ApiResponse.ok(res, 'Poll updated successfully', updatedPoll);
    } catch (error) {
      next(error);
    }
  }

  static async close(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      // Ending the voting window is a hosting action, like ending a live session.
      const poll = await authorizedPoll(req, 'deck:host');
      const closedPoll = await PollService.closePoll(String(poll._id));
      return ApiResponse.ok(res, 'Poll closed successfully', closedPoll);
    } catch (error) {
      next(error); // Sends error to your global errorHandler
    }
  }

  static async delete(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const poll = await authorizedPoll(req, 'deck:delete');
      await PollService.deletePoll(String(poll._id));
      return ApiResponse.ok(res, 'Poll deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  static async publishResults(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      // Makes the results public, so it needs the right to share them.
      const poll = await authorizedPoll(req, 'session:share');
      const publishedPoll = await PollService.publishResults(String(poll._id));
      return ApiResponse.ok(res, 'Poll results published successfully', publishedPoll);
    } catch (error) {
      next(error);
    }
  }
}
