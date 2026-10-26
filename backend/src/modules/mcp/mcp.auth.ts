import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { MCP_TOKEN_PREFIX } from './mcp.constants';
import type { McpScope } from './mcp.constants';
import { McpTokenService } from './mcp.token.service';

export interface McpAuthRequest extends Request {
  mcp?: {
    tokenId: string;
    tokenHash: string;
    scopes: McpScope[];
    /** Pinned workspace; null = the user's default workspace. */
    workspaceId: string | null;
    kind: 'pat' | 'oauth';
    clientId?: string;
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  };
}

export const mcpAuth = async (req: McpAuthRequest, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing MCP bearer token');
    }

    const rawToken = header.slice('Bearer '.length).trim();
    if (!rawToken.startsWith(MCP_TOKEN_PREFIX)) {
      throw ApiError.unauthorized('Invalid MCP token format');
    }

    const resolved = await McpTokenService.resolveToken(rawToken);
    req.mcp = {
      tokenId: resolved.tokenId,
      tokenHash: resolved.tokenHash,
      scopes: resolved.scopes,
      workspaceId: resolved.workspaceId,
      kind: 'pat',
      user: resolved.user,
    };

    next();
  } catch (error) {
    next(error instanceof ApiError ? error : ApiError.unauthorized('Invalid MCP token'));
  }
};
