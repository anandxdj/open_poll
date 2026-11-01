import { z } from 'zod';

/** `PATCH /api/me`: the signed-in user's display name. Unknown keys (email, role, …) are stripped. */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80, 'Name must be at most 80 characters'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
