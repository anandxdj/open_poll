import { z } from 'zod';

export const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address'),
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
