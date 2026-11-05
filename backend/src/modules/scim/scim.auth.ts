import type { NextFunction, Request, Response } from 'express';
import { env } from '../../common/config/env';
import { getEntitlements } from '../../common/plans/entitlements';
import { hashToken } from '../../common/utils/jwt.utils';
import { WorkspaceModel, type IWorkspace } from '../workspaces/workspace.model';
import { ScimError, sendScimError } from './scim.errors';
import { ScimTokenModel } from './scimToken.model';

export interface ScimRequest extends Request {
  scim?: { workspace: IWorkspace; tokenId: string };
}

/** Last-used times are written at most this often per token. */
const TOUCH_EVERY_MS = 60 * 1000;

/**
 * SCIM bearer authentication: a live token of a live team workspace whose plan
 * has `scim`, on a server with SCIM on. Every failure answers in SCIM's error
 * format; a wrong or revoked token is 401 whatever the reason, so tokens
 * cannot be probed.
 */
export const scimAuth = async (req: ScimRequest, res: Response, next: NextFunction) => {
  try {
    if (!env.capabilities.scim) throw new ScimError(503, 'SCIM provisioning is not enabled on this server');
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token.startsWith('scim_')) throw new ScimError(401, 'A SCIM bearer token is required');
    const record = await ScimTokenModel.findOne({ tokenHash: hashToken(token), revokedAt: null });
    const workspace = record ? await WorkspaceModel.findOne({ _id: record.workspaceId, deletedAt: null }) : null;
    if (!record || !workspace || workspace.type !== 'team') throw new ScimError(401, 'Invalid SCIM token');
    if (!getEntitlements(workspace).features.scim) throw new ScimError(403, 'The workspace plan does not include SCIM provisioning');
    if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      void ScimTokenModel.updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
    }
    req.scim = { workspace, tokenId: String(record._id) };
    next();
  } catch (error) {
    if (error instanceof ScimError) return void sendScimError(res, error);
    next(error);
  }
};
