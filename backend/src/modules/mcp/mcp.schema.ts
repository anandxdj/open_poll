import { z } from 'zod';

export const createMcpTokenSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(64, 'Label is too long'),
});

export type CreateMcpTokenInput = z.infer<typeof createMcpTokenSchema>;
