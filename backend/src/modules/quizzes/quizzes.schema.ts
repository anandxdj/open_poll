import { z } from 'zod';

const optionSchema = z.object({
  text: z.string().min(1, 'Option text is required').max(200),
  isCorrect: z.boolean().default(false),
});

export const quizSlideSchema = z
  .object({
    type: z.enum(['select_answer', 'type_answer']),
    question: z.string().min(1, 'Question text is required').max(500),
    options: z.array(optionSchema).max(8).default([]),
    acceptedAnswers: z.array(z.string().min(1).max(200)).max(20).default([]),
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
  deviceId: z.string().min(8).max(100),
});

export const submitQuizAnswerSchema = z
  .object({
    participantId: z.string().min(1),
    participantToken: z.string().min(16).max(128),
    slideIndex: z.number().int().min(0),
    optionIndex: z.number().int().min(0).max(7).optional(),
    text: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => v.optionIndex !== undefined || v.text !== undefined, {
    message: 'Provide an optionIndex or a text answer',
  });

export type CreateQuizInput = z.infer<typeof createQuizSchema>;
export type UpdateQuizInput = z.infer<typeof updateQuizSchema>;
export type JoinQuizInput = z.infer<typeof joinQuizSchema>;
export type SubmitQuizAnswerInput = z.infer<typeof submitQuizAnswerSchema>;
