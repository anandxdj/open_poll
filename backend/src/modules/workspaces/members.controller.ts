import type { NextFunction, Response } from 'express';
import type { z } from 'zod';
import { audit } from '../../common/audit/audit';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { InvitesService } from './invites.service';
import type { UpdateMemberInput } from './members.schema';
import { MembersService, type MembersActor } from './members.service';

/**
 * The caller acting on the workspace set by pathWorkspaceContext() (members
 * and invites) or workspaceContext() (shares).
 */
export function actorOf(req: WorkspaceRequest): MembersActor {
  if (!req.user) throw ApiError.unauthorized('Not authenticated');
  if (!req.workspace || !req.membership) throw ApiError.internal('Workspace context is missing');
  return { user: { id: req.user.id, name: req.user.name }, workspace: req.workspace, membership: req.membership };
}

/** Express 5 exposes `req.query` read-only, so queries are parsed here rather than by validate(). */
export function parseQuery<T extends z.ZodType>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw ApiError.badRequest(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return result.data;
}

function param(req: WorkspaceRequest, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw ApiError.badRequest(`${name} is required`);
  return value;
}

export class MembersController {
  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      return ApiResponse.ok(res, 'Members fetched successfully', await MembersService.list(actorOf(req)));
    } catch (error) {
      next(error);
    }
  }

  static async update(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const userId = param(req, 'userId');
      const input: UpdateMemberInput = req.body;
      const { before, member } = await MembersService.update(actorOf(req), userId, input);
      const target = { type: 'user', id: userId };
      if (member.role !== before.role) {
        void audit(req, 'member.role.update', target, { from: before.role, to: member.role, email: member.email });
      }
      if (member.status !== before.status) {
        void audit(req, 'member.status.update', target, { from: before.status, to: member.status, email: member.email });
      }
      return ApiResponse.ok(res, 'Member updated successfully', { member });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const userId = param(req, 'userId');
      const { member, self } = await MembersService.remove(actorOf(req), userId);
      void audit(req, self ? 'member.leave' : 'member.remove', { type: 'user', id: userId }, { role: member.role });
      return ApiResponse.ok(res, self ? 'You left the workspace' : 'Member removed');
    } catch (error) {
      next(error);
    }
  }

  static async transferOwnership(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const userId = param(req, 'userId');
      const actor = actorOf(req);
      const { member } = await MembersService.transferOwnership(actor, userId);
      void audit(req, 'workspace.owner.transfer', { type: 'user', id: userId }, { from: actor.user.id, to: userId });
      return ApiResponse.ok(res, 'Ownership transferred', { member });
    } catch (error) {
      next(error);
    }
  }
}

export class WorkspaceInvitesController {
  static async create(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const created = await InvitesService.create(actorOf(req), req.body);
      void audit(req, created.refreshed ? 'invite.refresh' : 'invite.create', { type: 'invite', id: created.invite.id }, {
        email: created.invite.email,
        role: created.invite.role,
        emailSent: created.emailSent,
      });
      return ApiResponse.created(res, created.refreshed ? 'Invitation refreshed' : 'Invitation created', created);
    } catch (error) {
      next(error);
    }
  }

  static async list(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      return ApiResponse.ok(res, 'Invitations fetched successfully', { invites: await InvitesService.list(actorOf(req)) });
    } catch (error) {
      next(error);
    }
  }

  static async revoke(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      const invite = await InvitesService.revoke(actorOf(req), param(req, 'inviteId'));
      void audit(req, 'invite.revoke', { type: 'invite', id: invite._id }, { email: invite.email, role: invite.role });
      return ApiResponse.ok(res, 'Invitation revoked');
    } catch (error) {
      next(error);
    }
  }
}

/** /api/invites: the invitee's side (public preview, authenticated accept). */
export class InviteLinkController {
  static async preview(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      return ApiResponse.ok(res, 'Invitation fetched successfully', await InvitesService.preview(param(req, 'token')));
    } catch (error) {
      next(error);
    }
  }

  static async accept(req: WorkspaceRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const { accepted, invite, workspace } = await InvitesService.accept(req.user.id, param(req, 'token'));
      void audit({ ip: req.ip, headers: req.headers, user: req.user, workspace }, 'invite.accept', { type: 'invite', id: invite._id }, {
        email: invite.email,
        role: accepted.membership.role,
        alreadyMember: accepted.alreadyMember,
      });
      return ApiResponse.ok(res, accepted.alreadyMember ? 'You are already a member' : 'Invitation accepted', accepted);
    } catch (error) {
      next(error);
    }
  }
}
