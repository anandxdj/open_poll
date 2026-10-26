import { getEntitlements } from '../../../common/plans/entitlements';
import { UserModel } from '../../auth/auth.model';
import { MCP_POLL_ONLY_SCOPES, MCP_SCOPE_LABELS, MCP_SCOPES } from '../mcp.constants';
import { frontendUrl, workspaceScope } from '../mcp.context';
import { defineTool } from './types';

export const CONTEXT_TOOLS = [
  defineTool({
    name: 'get_context',
    scope: null,
    description:
      'Who you are acting as: the user, the workspace this connection is pinned to (name, plan, your role in it), what this connection may do (scopes), and the Open Poll web address. Call it first when unsure what you can do; a role or scope missing here is why a tool is refused.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async handler(_args, ctx) {
      const scope = await workspaceScope(ctx);
      const user = await UserModel.findById(ctx.userId).select('name email');
      const entitlements = getEntitlements(scope.workspace);
      const missing = MCP_SCOPES.filter((name) => !ctx.scopes.includes(name));
      const pollOnly = missing.length > 0 && ctx.scopes.every((name) => MCP_POLL_ONLY_SCOPES.includes(name));

      return {
        user: { id: ctx.userId, name: user?.name ?? null, email: user?.email ?? null },
        workspace: {
          id: String(scope.workspace._id),
          name: scope.workspace.name,
          type: scope.workspace.type,
          plan: scope.workspace.plan,
          role: scope.membership.role,
          audienceCap: entitlements.limits.audienceCap ?? null,
          pinned: Boolean(ctx.workspaceId),
        },
        connection: ctx.kind ?? 'pat',
        scopes: ctx.scopes.map((name) => ({ scope: name, allows: MCP_SCOPE_LABELS[name] })),
        webApp: frontendUrl(),
        ...(pollOnly
          ? {
              note: 'This token was issued before decks and live sessions reached MCP, so it can only manage polls. Generate a new token in Settings → MCP (or connect through OAuth) to create decks, run sessions and read results.',
            }
          : {}),
      };
    },
  }),
];
