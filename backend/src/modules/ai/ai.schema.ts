import { z } from 'zod';
import { createPollSchema } from '../polls/polls.schema';

export const generatePollRequestSchema = z.object({
  prompt: z.string().min(10, 'prompt must be at least 10 characters'),
  isAnonymous: z.boolean().default(true),
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: 'Expiry date must be in the future',
  }),
});

export const generatedPollSchema = createPollSchema.pick({
  title: true,
  questions: true,
}).extend({
  isAnonymous: z.boolean(),
  expiresAt: z.string(),
  isPublished: z.boolean().default(false),
});

export const generateAndSavePollRequestSchema = generatePollRequestSchema.extend({
  creatorId: z.string().default('mock-creator-id-123'),
});

export type GeneratePollRequestInput = z.infer<typeof generatePollRequestSchema>;
export type GeneratedPollOutput = z.infer<typeof generatedPollSchema>;
export type GenerateAndSavePollRequestInput = z.infer<typeof generateAndSavePollRequestSchema>;
