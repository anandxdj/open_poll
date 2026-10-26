import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../../common/utils/ApiError';
import { MCP_OAUTH_ACCESS_PREFIX, MCP_TOKEN_PREFIX } from './mcp.constants';
import type { McpScope } from './mcp.constants';
import { McpTokenService } from './mcp.token.service';
import { protectedResourceMetadataUrl, verifyAccessToken } from './oauth/oauth.service';

export interface McpAuthRequest extends Request {
  mcp?: {
    /** The PAT id, or the OAuth grant id. */
    tokenId: string;
    /** Rate-limit key: the PAT hash, or the grant (its access token rotates hourly). */
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

/**
 * Two kinds of bearer token reach /mcp: a personal access token pasted into a
 * client config (`opoll_mcp_…`), and an OAuth access token a connector got
 * through the consent page (`opoll_oat_…`). A request without a usable token
 * gets a 401 whose WWW-Authenticate header points at the protected resource
 * metadata (RFC 9728), which is how Claude and ChatGPT find the OAuth server.
 */
export const mcpAuth = async (req: McpAuthRequest, res: Response, next: NextFunction) => {
  const challenge = (error?: string) =>
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${protectedResourceMetadataUrl(req)}"${error ? `, error="${error}"` : ''}`,
    );

  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      challenge();
      throw ApiError.unauthorized('Missing MCP bearer token');
    }

    const rawToken = header.slice('Bearer '.length).trim();

    if (rawToken.startsWith(MCP_OAUTH_ACCESS_PREFIX)) {
      const verified = await verifyAccessToken(rawToken);
      req.mcp = {
        tokenId: verified.grantId,
        tokenHash: `grant:${verified.grantId}`,
        scopes: verified.scopes,
        workspaceId: verified.workspaceId,
        kind: 'oauth',
        clientId: verified.clientId,
        user: verified.user,
      };
      return next();
    }

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
    if (!res.hasHeader('WWW-Authenticate')) challenge('invalid_token');
    next(error instanceof ApiError ? error : ApiError.unauthorized('Invalid MCP token'));
  }
};
