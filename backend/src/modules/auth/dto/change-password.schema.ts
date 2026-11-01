import { z } from 'zod';
import { resetPasswordSchema } from './reset-password.schema';

/** `POST /api/me/password`: the new password follows the reset-password rules. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(200),
  newPassword: resetPasswordSchema.shape.password,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
