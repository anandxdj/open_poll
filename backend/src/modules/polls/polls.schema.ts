import { z } from 'zod';

const pollQuestionSchema = z.object({
  text: z.string().min(3, "Question text must be at least 3 characters"),
  options: z.array(z.string().min(1, "Option cannot be empty")).min(2, "Each question needs at least 2 options"),
  type: z.enum(['single', 'multiple']).default('single'),
  correctOptionIndices: z.array(z.number().int().min(0)).default([]),
  explanation: z.string().default(''),
  points: z.number().min(1).default(1),
  isMandatory: z.boolean().default(true),
});

export const createPollSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long"),
  pollType: z.enum(['POLL', 'TRIAL']).default('POLL'),
  passingScorePercentage: z.number().min(0).max(100).default(70),
  isAnonymous: z.boolean().default(true),
  // Expecting a future date string
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: "Expiry date must be in the future",
  }),
  isPublished: z.boolean().default(false),
  questions: z.array(pollQuestionSchema).min(1, "A poll must contain at least one question"),
});

export const updatePollSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters long").optional(),
  pollType: z.enum(['POLL', 'TRIAL']).optional(),
  passingScorePercentage: z.number().min(0).max(100).optional(),
  isAnonymous: z.boolean().optional(),
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: "Expiry date must be in the future",
  }).optional(),
  isPublished: z.boolean().optional(),
  questions: z.array(pollQuestionSchema).min(1, "A poll must contain at least one question").optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field is required for update",
});

// Export inferred TS type for our Service
export type CreatePollInput = z.infer<typeof createPollSchema>;
export type UpdatePollInput = z.infer<typeof updatePollSchema>;