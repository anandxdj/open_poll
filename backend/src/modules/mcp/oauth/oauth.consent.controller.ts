import type { Response, NextFunction } from 'express';
import { audit } from '../../../common/audit/audit';
import { ApiError } from '../../../common/utils/ApiError';
import { ApiResponse } from '../../../common/utils/ApiResponse';
import type { AuthRequest } from '../../auth/auth.middleware';
import { WorkspaceService } from '../../workspaces/workspaces.service';
import { MCP_SCOPE_LABELS } from '../mcp.constants';
import type { ApproveOAuthRequestInput } from '../mcp.schema';
import { approveAuthorization, denyAuthorization, getPendingAuthorization } from './oauth.service';

/** Where the app sends people back to, as the consent page shows it: the host, or the app scheme. */
const redirectTarget = (uri: string) => {
  const url = new URL(uri);
  return url.host || url.protocol.replace(/:$/, '');
};

const requestIdOf = (req: AuthRequest) => {
  const id = req.params.requestId;
  if (!id) throw ApiError.badRequest('requestId is required');
  return String(id);
};

/**
 * The consent page's API (`/oauth/consent` on the frontend). Bearer-JWT only
 * like every API route, so a third-party page cannot approve on the user's
 * behalf; the request id itself is a 256-bit secret that lives ten minutes.
 */
export class OAuthConsentController {
  static async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const pending = await getPendingAuthorization(requestIdOf(req));
      const { defaultWorkspaceId, workspaces } = await WorkspaceService.listForUser(req.user.id);

      return ApiResponse.ok(res, 'Connection request fetched', {
        request: {
          client: { name: pending.clientName, redirectTo: redirectTarget(pending.redirectUri) },
          scopes: pending.scopes.map((scope) => ({ scope, label: MCP_SCOPE_LABELS[scope] })),
          expiresAt: new Date(pending.expiresAt).toISOString(),
        },
        workspaces: workspaces.map((workspace) => ({
          id: workspace._id,
          name: workspace.name,
          type: workspace.type,
          role: workspace.role,
          plan: workspace.plan,
        })),
        defaultWorkspaceId,
      });
    } catch (error) {
      next(error);
    }
  }

  static async approve(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      const input = req.body as ApproveOAuthRequestInput;
      const { redirectUrl, pending, workspace } = await approveAuthorization(requestIdOf(req), req.user.id, input);
      void audit(
        { actorType: 'user', actorId: req.user.id, workspace, ip: req.ip ?? null },
        'mcp.oauth_connect',
        { type: 'oauth_client', id: pending.clientId },
        { clientName: pending.clientName, scopes: input.scopes },
      );
      return ApiResponse.ok(res, 'Connection approved', { redirectUrl });
    } catch (error) {
      next(error);
    }
  }

  static async deny(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) throw ApiError.unauthorized('Not authenticated');
      return ApiResponse.ok(res, 'Connection declined', await denyAuthorization(requestIdOf(req)));
    } catch (error) {
      next(error);
    }
  }
}
