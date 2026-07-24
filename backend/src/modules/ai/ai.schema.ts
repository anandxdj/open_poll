import { z } from 'zod';
import { createPollSchema } from '../polls/polls.schema';
import { QUIZ_SLIDE_TYPES, quizSlideSchema } from '../quizzes/quizzes.schema';

export const generatePollRequestSchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters'),
  pollType: z.enum(['POLL', 'TRIAL']).default('POLL'),
  tone: z
    .enum(['professional', 'casual', 'funny', 'educational', 'professional & casual'])
    .default('professional & casual'),
  questionCount: z.number().int().min(1).max(10).default(5),
  passingScorePercentage: z.number().min(0).max(100).default(70),
  isAnonymous: z.boolean().default(true),
  expiresAt: z.string().refine((val) => new Date(val).getTime() > Date.now(), {
    message: 'Expiry date must be in the future',
  }),
});

export const generatedPollSchema = createPollSchema.pick({
  title: true,
  questions: true,
}).extend({
  pollType: z.enum(['POLL', 'TRIAL']).default('POLL'),
  passingScorePercentage: z.number().default(70),
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

// ---------- Quiz AI Schemas ----------

export const generateQuizRequestSchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters'),
  slideCount: z.number().int().min(1).max(15).default(5),
  slideTypes: z
    .array(z.enum(QUIZ_SLIDE_TYPES))
    .min(1, 'Select at least one slide type')
    .default(['select_answer', 'type_answer']),
  tone: z.string().default('educational'),
});

// Simplified for Gemini API structured output compatibility
export const generatedQuizSlideOptionSchemaForLLM = z.object({
  text: z.string(),
  isCorrect: z.boolean(),
});

export const generatedQuizSlideSchemaForLLM = z.object({
  type: z.enum(QUIZ_SLIDE_TYPES),
  question: z.string(),
  options: z.array(generatedQuizSlideOptionSchemaForLLM).optional(),
  correctOptionIndex: z.number().optional(),
  acceptedAnswers: z.array(z.string()).optional(),
  statements: z.array(z.string()).optional(),
  minLabel: z.string().optional(),
  maxLabel: z.string().optional(),
  items: z.array(z.string()).optional(),
  timeLimit: z.number().optional(),
  points: z.number().optional(),
});

export const generatedQuizSchemaForLLM = z.object({
  title: z.string(),
  slides: z.array(generatedQuizSlideSchemaForLLM),
});

export const generatedQuizSlideSchema = z.object({
  type: z.enum(QUIZ_SLIDE_TYPES),
  question: z.string().min(1).max(500),
  options: z
    .array(
      z.object({
        text: z.string().min(1).max(200),
        isCorrect: z.boolean(),
      })
    )
    .max(8)
    .default([]),
  correctOptionIndex: z.number().int().min(0).max(7).optional(),
  acceptedAnswers: z.array(z.string().min(1).max(200)).max(20).default([]),
  statements: z.array(z.string().min(1).max(200)).max(10).default([]),
  minLabel: z.string().max(40).default(''),
  maxLabel: z.string().max(40).default(''),
  scaleMax: z.number().int().min(2).max(10).default(5),
  items: z.array(z.string().min(1).max(200)).max(10).default([]),
  maxEntries: z.number().int().min(1).max(3).default(3),
  timeLimit: z.number().int().min(5).max(300).default(30),
  points: z.number().int().min(0).max(10000).default(1000),
  scoreDependsOnTime: z.boolean().default(true),
});

export type GenerateQuizRequestInput = z.infer<typeof generateQuizRequestSchema>;
export type GeneratedQuizDraftOutput = {
  title: string;
  slides: z.infer<typeof quizSlideSchema>[];
};
