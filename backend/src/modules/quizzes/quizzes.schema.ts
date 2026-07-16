import { z } from 'zod';

const optionSchema = z.object({
  text: z.string().min(1, 'Option text is required').max(200),
  isCorrect: z.boolean().default(false),
});

export const QUIZ_SLIDE_TYPES = [
  'select_answer',
  'type_answer',
  'wordcloud',
  'open_ended',
  'scales',
  'ranking',
] as const;

export const quizSlideSchema = z
  .object({
    type: z.enum(QUIZ_SLIDE_TYPES),
    question: z.string().min(1, 'Question text is required').max(500),
    options: z.array(optionSchema).max(8).default([]),
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
  })
  .superRefine((slide, ctx) => {
    if (slide.type === 'select_answer') {
      if (slide.options.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Select-answer slides need at least 2 options',
        });
      }
      if (!slide.options.some((o) => o.isCorrect)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Mark at least one option as correct',
        });
      }
    }
    if (slide.type === 'type_answer' && slide.acceptedAnswers.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptedAnswers'],
        message: 'Type-answer slides need at least one accepted answer',
      });
    }
    if (slide.type === 'scales' && slide.statements.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['statements'],
        message: 'Scales slides need at least one statement',
      });
    }
    if (slide.type === 'ranking' && slide.items.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Ranking slides need at least 2 items',
      });
    }
  });

export const createQuizSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  slides: z.array(quizSlideSchema).min(1, 'A quiz needs at least one slide').max(50),
});

export const updateQuizSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  slides: z.array(quizSlideSchema).min(1).max(50).optional(),
});

export const joinQuizSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(30),
  // Server-signed device token from a previous join — enables refresh-safe
  // rejoin. Absent or invalid → the server mints a fresh identity.
  deviceToken: z.string().max(256).optional(),
});

export const submitQuizAnswerSchema = z
  .object({
    participantId: z.string().min(1),
    participantToken: z.string().min(16).max(128),
    slideIndex: z.number().int().min(0),
    // select_answer
    optionIndex: z.number().int().min(0).max(7).optional(),
    // type_answer + open_ended
    text: z.string().trim().min(1).max(500).optional(),
    // wordcloud — up to 3 short entries in one submission
    entries: z.array(z.string().trim().min(1).max(60)).min(1).max(3).optional(),
    // scales — one rating per statement
    ratings: z.array(z.number().int().min(1).max(10)).min(1).max(10).optional(),
    // ranking — item indices in the participant's chosen order (a permutation)
    ranking: z.array(z.number().int().min(0).max(9)).min(2).max(10).optional(),
  })
  .refine(
    (v) =>
      v.optionIndex !== undefined ||
      v.text !== undefined ||
      v.entries !== undefined ||
      v.ratings !== undefined ||
      v.ranking !== undefined,
    { message: 'Provide an answer payload' }
  );

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type UpdateQuizInput = z.infer<typeof updateQuizSchema>;
export type JoinQuizInput = z.infer<typeof joinQuizSchema>;
export type SubmitQuizAnswerInput = z.infer<typeof submitQuizAnswerSchema>;
