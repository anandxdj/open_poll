import type { NextFunction, Response } from 'express';
import type { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import type { AuthRequest } from '../../modules/auth/auth.middleware';
import { UserModel } from '../../modules/auth/auth.model';
import { WorkspaceModel, type IWorkspace } from '../../modules/workspaces/workspace.model';
import { WorkspaceMemberModel, type IWorkspaceMember } from '../../modules/workspaces/workspaceMember.model';
import { ensurePersonalWorkspace } from '../../modules/workspaces/provisioning';

/** Request header selecting the workspace; without it the user's default workspace is used. */
export const WORKSPACE_HEADER = 'X-Workspace-Id';

export interface WorkspaceContext {
  workspace: IWorkspace;
  membership: IWorkspaceMember;
}

/** A request after authenticate() + workspaceContext(); satisfies PolicyContext. */
export interface WorkspaceRequest extends AuthRequest {
  workspace?: IWorkspace;
  membership?: IWorkspaceMember;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const notAMember = () => new ApiError(403, 'You are not a member of this workspace', 'WORKSPACE_FORBIDDEN');

/** The live workspace plus the user's active membership of it, or null. */
async function loadActive(workspaceId: Types.ObjectId | string, userId: string): Promise<WorkspaceContext | null> {
  const [workspace, membership] = await Promise.all([
    WorkspaceModel.findOne({ _id: workspaceId, deletedAt: null }),
    WorkspaceMemberModel.findOne({ workspaceId, userId, status: 'active' }),
  ]);
  return workspace && membership ? { workspace, membership } : null;
}

/**
 * Resolves the workspace a user is acting in:
 * - `requestedId` (the X-Workspace-Id header) must be a live workspace with an
 *   active membership, else 403 WORKSPACE_FORBIDDEN;
 * - otherwise the user's default workspace, falling back to their personal
 *   workspace, which is provisioned on first use (so sign-up and sign-in flows
 *   need no workspace code). A stale default is repointed to the personal one.
 */
export async function resolveWorkspaceContext(userId: string, requestedId?: string): Promise<WorkspaceContext> {
  if (requestedId) {
    if (!OBJECT_ID.test(requestedId)) throw notAMember();
    const context = await loadActive(requestedId, userId);
    if (!context) throw notAMember();
    return context;
  }

  const user = await UserModel.findById(userId).select('name defaultWorkspaceId');
  if (!user) throw ApiError.unauthorized('User no longer exists');

  const defaultId = user.defaultWorkspaceId ?? null;
  if (defaultId) {
    const context = await loadActive(defaultId, userId);
    if (context) return context;
  }

  const personal = await ensurePersonalWorkspace({ _id: user._id, name: user.name, defaultWorkspaceId: defaultId });
  if (personal.workspace.deletedAt || personal.membership.status !== 'active') throw notAMember();
  if (defaultId && String(defaultId) !== String(personal.workspace._id)) {
    await UserModel.updateOne(
      { _id: user._id, defaultWorkspaceId: defaultId },
      { $set: { defaultWorkspaceId: personal.workspace._id } },
    );
  }
  return personal;
}

/**
 * Sets `req.workspace` and `req.membership`. Mount after authenticate().
 * Routes then authorize with `assertCan(req, action, resource)`.
 */
export const workspaceContext = () => async (req: WorkspaceRequest, _res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw ApiError.unauthorized('Not authenticated');
    const header = req.get(WORKSPACE_HEADER)?.trim();
    const { workspace, membership } = await resolveWorkspaceContext(req.user.id, header || undefined);
    req.workspace = workspace;
    req.membership = membership;
    next();
  } catch (error) {
    next(error);
  }
};
