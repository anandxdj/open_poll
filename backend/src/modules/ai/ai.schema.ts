import { z } from 'zod';
import { createPollSchema } from '../polls/polls.schema';
import { QUIZ_SLIDE_TYPES } from '../quizzes/quizzes.schema';

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

// ---------- Quiz generation ----------

export const generateQuizRequestSchema = z.object({
  topic: z.string().min(3, 'Topic must be at least 3 characters').max(500),
  slideCount: z.number().int().min(1).max(15).default(5),
  // Which slide types the AI may use; defaults to scored quiz types only
  slideTypes: z
    .array(z.enum(QUIZ_SLIDE_TYPES))
    .min(1)
    .default(['select_answer', 'type_answer']),
  tone: z
    .enum(['professional', 'casual', 'funny', 'educational', 'professional & casual'])
    .default('professional & casual'),
});

// Flat slide shape for LLM structured output — unions confuse structured
// output, so every per-type field is optional here and repaired afterwards.
export const generatedQuizSlideSchema = z.object({
  type: z.enum(QUIZ_SLIDE_TYPES),
  question: z.string().min(1).max(500),
  options: z
    .array(z.object({ text: z.string().min(1).max(200), isCorrect: z.boolean() }))
    .max(8)
    .default([]),
  acceptedAnswers: z.array(z.string().min(1).max(200)).max(20).default([]),
  statements: z.array(z.string().min(1).max(200)).max(10).default([]),
  minLabel: z.string().max(40).default(''),
  maxLabel: z.string().max(40).default(''),
  items: z.array(z.string().min(1).max(200)).max(10).default([]),
  timeLimit: z.number().int().min(5).max(300).default(30),
  points: z.number().int().min(0).max(10000).default(1000),
});

export const generatedQuizSchema = z.object({
  title: z.string().min(1).max(120),
  slides: z.array(generatedQuizSlideSchema).min(1).max(50),
});

// Gemini rejects JSON schemas with `default` values — use this for withStructuredOutput only.
export const generatedQuizSlideSchemaForLLM = z.object({
  type: z.enum(QUIZ_SLIDE_TYPES),
  question: z.string().max(500),
  options: z.array(z.object({ text: z.string().max(200), isCorrect: z.boolean() })).max(8),
  acceptedAnswers: z.array(z.string().max(200)).max(20),
  statements: z.array(z.string().max(200)).max(10),
  minLabel: z.string().max(40),
  maxLabel: z.string().max(40),
  items: z.array(z.string().max(200)).max(10),
  timeLimit: z.number().int().min(5).max(300),
  points: z.number().int().min(0).max(10000),
});

export const generatedQuizSchemaForLLM = z.object({
  title: z.string().max(120),
  slides: z.array(generatedQuizSlideSchemaForLLM).max(50),
});

export type GenerateQuizRequestInput = z.infer<typeof generateQuizRequestSchema>;
export type GeneratedQuizOutput = z.infer<typeof generatedQuizSchema>;
