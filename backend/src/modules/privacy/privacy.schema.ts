import { z } from 'zod';

/** `POST /api/me/reauth`: a password account confirms its password before deleting itself. */
export const reauthSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(200),
});

export type ReauthInput = z.infer<typeof reauthSchema>;
