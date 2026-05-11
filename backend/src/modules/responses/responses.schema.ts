import { z } from 'zod';

export const submitResponseSchema = z.object({
  pollId: z.string().min(1, 'pollId is required'),
  deviceId: z.string().min(1, 'deviceId is required'),
  respondentId: z.string().optional(),
  answers: z.array(
    z.object({
      questionId: z.string().min(1, 'questionId is required'),
      selectedOptionIndex: z.number().int().min(0),
    }),
  ).min(1, 'At least one answer is required'),
});

export type SubmitResponseInput = z.infer<typeof submitResponseSchema>;
