import { z } from 'zod';

export const createMcpTokenSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(64, 'Label is too long'),
  /** Pin the token to this workspace; omitted = follow the user's default workspace. */
  workspaceId: z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid workspace id').optional(),
});

export type CreateMcpTokenInput = z.infer<typeof createMcpTokenSchema>;
