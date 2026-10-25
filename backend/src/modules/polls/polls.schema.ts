import { z } from 'zod';
import { answerIndexProblems } from './polls.grading';

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

// What POST /api/polls validates. Kept separate from createPollSchema because
// ai.schema.ts calls createPollSchema.pick(), and zod refuses .pick() on an object
// schema that carries refinements — refining the base schema would break the AI
// module at import time.
//
// Only a PUBLISHED assessment must be gradeable: the web builder autosaves TRIAL
// drafts before the author has marked any answers, and respondents can only reach
// published polls. PollService re-checks on publish, so a draft cannot go live
// without answers.
export const createPollRequestSchema = createPollSchema.superRefine((poll, ctx) => {
  if (poll.pollType !== 'TRIAL' || !poll.isPublished) return;

  poll.questions.forEach((question, index) => {
    const path = ['questions', index, 'correctOptionIndices'];
    if (!question.correctOptionIndices.length) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'A published assessment needs at least one correct option on every question',
      });
    }
    for (const message of answerIndexProblems(question)) {
      ctx.addIssue({ code: 'custom', path, message });
    }
  });
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