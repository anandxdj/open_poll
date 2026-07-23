import type { Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { McpTokenService } from './mcp.token.service';
import { getMcpPublicUrl } from './mcp.constants';

export class McpSettingsController {
  static async createToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');

      const issued = await McpTokenService.issueToken(req.user.id, req.body.label);

      return ApiResponse.created(res, 'MCP token created successfully', {
        token: issued.token,
        connectorConfig: issued.connectorConfig,
        meta: issued.meta,
        mcpUrl: `${getMcpPublicUrl()}/mcp`,
      });
    } catch (error) {
      next(error);
    }
  }

  static async listTokens(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');

      const tokens = await McpTokenService.listTokens(req.user.id);
      return ApiResponse.ok(res, 'MCP tokens fetched successfully', {
        tokens,
        mcpUrl: `${getMcpPublicUrl()}/mcp`,
      });
    } catch (error) {
      next(error);
    }
  }

  static async revokeToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');

      const tokenId = req.params.tokenId;
      if (!tokenId) throw ApiError.badRequest('tokenId is required');

      await McpTokenService.revokeToken(req.user.id, String(tokenId));
      return ApiResponse.ok(res, 'MCP token revoked successfully');
    } catch (error) {
      next(error);
    }
  }
}
