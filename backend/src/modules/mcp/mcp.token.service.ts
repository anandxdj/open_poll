import * as crypto from 'crypto';
import { hashToken } from '../../common/utils/jwt.utils';
import { ApiError } from '../../common/utils/ApiError';
import {
  MCP_MAX_TOKENS_PER_USER,
  MCP_SCOPES,
  MCP_TOKEN_PREFIX,
  buildMcpConnectorConfig,
  type McpScope,
} from './mcp.constants';
import { McpTokenModel } from './mcp.token.model';
import { UserModel } from '../auth/auth.model';
import { isAccountUsable } from '../auth/auth.service';
import { resolveWorkspaceContext } from '../../common/tenancy/workspaceContext.middleware';

function generateRawToken(): string {
  const random = crypto.randomBytes(32).toString('base64url');
  return `${MCP_TOKEN_PREFIX}${random}`;
}

function toTokenMeta(doc: {
  _id: unknown;
  prefix: string;
  last4: string;
  label: string;
  scopes: McpScope[];
  workspaceId?: unknown;
  lastUsedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt: Date;
}) {
  return {
    id: String(doc._id),
    prefix: doc.prefix,
    last4: doc.last4,
    label: doc.label,
    scopes: doc.scopes,
    workspaceId: doc.workspaceId ? String(doc.workspaceId) : null,
    lastUsedAt: doc.lastUsedAt ?? null,
    expiresAt: doc.expiresAt ?? null,
    createdAt: doc.createdAt,
  };
}

export class McpTokenService {
  // baseUrl comes from the caller's request origin so the copied connector config
  // points at this deployment rather than localhost. Omitted callers fall back to
  // getMcpPublicUrl()'s env-based resolution. workspaceId pins the token to one
  // workspace (the caller must be an active member); without it the token follows
  // the user's default workspace.
  static async issueToken(userId: string, label: string, baseUrl?: string, workspaceId?: string) {
    if (workspaceId) await resolveWorkspaceContext(userId, workspaceId);

    const activeCount = await McpTokenModel.countDocuments({ userId });
    if (activeCount >= MCP_MAX_TOKENS_PER_USER) {
      throw ApiError.badRequest(`You can have at most ${MCP_MAX_TOKENS_PER_USER} active MCP tokens`);
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const visible = rawToken.slice(MCP_TOKEN_PREFIX.length);
    const prefix = visible.slice(0, 8);
    const last4 = visible.slice(-4);

    const doc = await McpTokenModel.create({
      userId,
      tokenHash,
      prefix,
      last4,
      label,
      scopes: [...MCP_SCOPES],
      workspaceId: workspaceId ?? null,
    });

    return {
      token: rawToken,
      connectorConfig: buildMcpConnectorConfig(rawToken, baseUrl),
      meta: toTokenMeta(doc),
    };
  }

  static async listTokens(userId: string) {
    const docs = await McpTokenModel.find({ userId }).sort({ createdAt: -1 });
    return docs.map(toTokenMeta);
  }

  static async revokeToken(userId: string, tokenId: string) {
    const doc = await McpTokenModel.findOneAndDelete({ _id: tokenId, userId });
    if (!doc) {
      throw ApiError.notFound('MCP token not found');
    }
  }

  static async resolveToken(rawToken: string) {
    if (!rawToken.startsWith(MCP_TOKEN_PREFIX)) {
      throw ApiError.unauthorized('Invalid MCP token');
    }

    const tokenHash = hashToken(rawToken);
    const doc = await McpTokenModel.findOne({ tokenHash });
    if (!doc) {
      throw ApiError.unauthorized('Invalid MCP token');
    }

    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
      throw ApiError.unauthorized('MCP token expired');
    }

    const user = await UserModel.findById(doc.userId);
    if (!user || !isAccountUsable(user)) {
      throw ApiError.unauthorized('User no longer exists');
    }

    void McpTokenModel.updateOne({ _id: doc._id }, { lastUsedAt: new Date() });

    return {
      tokenId: String(doc._id),
      tokenHash,
      scopes: doc.scopes as McpScope[],
      workspaceId: doc.workspaceId ? String(doc.workspaceId) : null,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }
}
