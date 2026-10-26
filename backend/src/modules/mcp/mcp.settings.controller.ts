import type { Response, NextFunction } from 'express';
import { ApiResponse } from '../../common/utils/ApiResponse';
import { ApiError } from '../../common/utils/ApiError';
import type { AuthRequest } from '../auth/auth.middleware';
import { McpTokenService } from './mcp.token.service';
import { getMcpPublicUrl } from './mcp.constants';
import { audit } from '../../common/audit/audit';
import { WorkspaceModel } from '../workspaces/workspace.model';
import { McpGrantModel } from './oauth/oauth.grant.model';
import { toGrantView } from './oauth/oauth.service';

export class McpSettingsController {
  static async createToken(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');

      const baseUrl = getMcpPublicUrl(req);
      const issued = await McpTokenService.issueToken(req.user.id, req.body.label, baseUrl, req.body.workspaceId);

      return ApiResponse.created(res, 'MCP token created successfully', {
        token: issued.token,
        connectorConfig: issued.connectorConfig,
        meta: issued.meta,
        mcpUrl: `${baseUrl}/mcp`,
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
        mcpUrl: `${getMcpPublicUrl(req)}/mcp`,
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

  /** Connected apps: OAuth grants of this user, newest first. */
  static async listGrants(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');

      const grants = await McpGrantModel.find({ userId: req.user.id }).sort({ createdAt: -1 });
      const workspaces = await WorkspaceModel.find({ _id: { $in: grants.map((grant) => grant.workspaceId) } }).select('name');
      const names = new Map(workspaces.map((workspace) => [String(workspace._id), workspace.name]));
      return ApiResponse.ok(res, 'Connected apps fetched successfully', {
        grants: grants.map((grant) => toGrantView(grant, names)),
      });
    } catch (error) {
      next(error);
    }
  }

  /** Disconnects an app: its access and refresh tokens stop working at once. */
  static async revokeGrant(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');

      const grantId = String(req.params.grantId ?? '');
      const grant = /^[a-f0-9]{24}$/i.test(grantId)
        ? await McpGrantModel.findOneAndDelete({ _id: grantId, userId: req.user.id })
        : null;
      if (!grant) throw ApiError.notFound('Connected app not found');

      const workspace = await WorkspaceModel.findById(grant.workspaceId);
      void audit(
        { actorType: 'user', actorId: req.user.id, workspace, ip: req.ip ?? null },
        'mcp.oauth_disconnect',
        { type: 'oauth_client', id: grant.clientId },
        { clientName: grant.clientName },
      );
      return ApiResponse.ok(res, 'App disconnected successfully');
    } catch (error) {
      next(error);
    }
  }
}
