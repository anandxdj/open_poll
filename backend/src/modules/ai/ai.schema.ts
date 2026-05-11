import { z } from 'zod';
import { createPollSchema } from '../polls/polls.schema';

export const generatePollRequestSchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters'),
  tone: z
    .enum(['professional', 'casual', 'funny', 'educational', 'professional & casual'])
    .default('professional & casual'),
  questionCount: z.number().int().min(1).max(10).default(5),
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
