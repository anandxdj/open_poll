import { z } from 'zod';
import { MCP_SCOPES } from './mcp.constants';

export const createMcpTokenSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(64, 'Label is too long'),
  /** Pin the token to this workspace; omitted = follow the user's default workspace. */
  workspaceId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid workspace id').optional(),
});

export type CreateMcpTokenInput = z.infer<typeof createMcpTokenSchema>;

/** `POST /api/oauth/requests/:requestId/approve`: where the app may act, and with what. */
export const approveOAuthRequestSchema = z.object({
  workspaceId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid workspace id'),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1, 'Choose at least one permission'),
});

export type ApproveOAuthRequestInput = z.infer<typeof approveOAuthRequestSchema>;
