import { z } from 'zod';

// No `role`: public signup always creates a plain user. Unknown keys are stripped.
export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().trim().toLowerCase().email('Invalid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter and one digit'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
