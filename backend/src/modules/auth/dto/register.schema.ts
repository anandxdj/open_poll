import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(50),
  email: z.string().email('Invalid email address').lowercase(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one uppercase letter and one digit'),
  role: z.enum(['user', 'admin']).default('user'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
