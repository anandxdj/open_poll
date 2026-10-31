import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { audit } from '../../common/audit/audit';
import { env } from '../../common/config/env';
import { assertFeature } from '../../common/plans/entitlements';
import { assertCan } from '../../common/tenancy/policy';
import type { WorkspaceRequest } from '../../common/tenancy/workspaceContext.middleware';
import { ApiError } from '../../common/utils/ApiError';
import { hashToken } from '../../common/utils/jwt.utils';
import { ScimTokenModel, type IScimToken } from './scimToken.model';

type Ctx = WorkspaceRequest & { user: NonNullable<WorkspaceRequest['user']> };

/** Live tokens one workspace keeps. */
export const MAX_SCIM_TOKENS = 5;

/** Same gates as single sign-on settings, with the `scim` capability and plan feature. */
function assertScimAdmin(ctx: Ctx) {
  if (!env.capabilities.scim) throw new ApiError(503, 'SCIM provisioning is not enabled on this server', 'SCIM_DISABLED');
  if (ctx.workspace!.type !== 'team') throw new ApiError(403, 'Only team workspaces have SCIM provisioning', 'TEAM_WORKSPACE_ONLY');
  assertCan(ctx, 'workspace:sso');
  assertFeature(ctx.workspace!, 'scim');
}

const view = (token: IScimToken) => ({
  id: String(token._id),
  label: token.label,
  prefix: token.prefix,
  last4: token.last4,
  lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
  createdAt: token.createdAt.toISOString(),
});

export class ScimTokenService {
  static async list(ctx: Ctx) {
    assertScimAdmin(ctx);
    const tokens = await ScimTokenModel.find({ workspaceId: ctx.workspace!._id, revokedAt: null }).sort({ createdAt: -1 });
    return { baseUrl: `${env.apiPublicUrl}/scim/v2`, tokens: tokens.map(view) };
  }

  /** The token itself is returned only here. */
  static async create(ctx: Ctx, label: string) {
    assertScimAdmin(ctx);
    const workspaceId = ctx.workspace!._id;
    if ((await ScimTokenModel.countDocuments({ workspaceId, revokedAt: null })) >= MAX_SCIM_TOKENS) {
      throw new ApiError(409, `A workspace keeps up to ${MAX_SCIM_TOKENS} SCIM tokens`, 'SCIM_TOKEN_LIMIT');
    }
    const secret = `scim_${randomBytes(32).toString('base64url')}`;
    const token = await ScimTokenModel.create({
      workspaceId,
      label,
      tokenHash: hashToken(secret),
      prefix: secret.slice(0, 9),
      last4: secret.slice(-4),
      createdBy: ctx.user.id,
    });
    void audit(ctx, 'scim.token_create', { type: 'scim_token', id: token._id }, { label });
    return { token: secret, ...view(token) };
  }

  static async revoke(ctx: Ctx, id: string) {
    assertScimAdmin(ctx);
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('SCIM token not found');
    const token = await ScimTokenModel.findOneAndUpdate(
      { _id: id, workspaceId: ctx.workspace!._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!token) throw ApiError.notFound('SCIM token not found');
    void audit(ctx, 'scim.token_revoke', { type: 'scim_token', id: token._id }, { label: token.label });
    return { id: String(token._id), revoked: true as const };
  }
}
