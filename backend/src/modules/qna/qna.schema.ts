import { z } from 'zod';
import { QNA_HOST_STATUSES, QNA_STATUSES, QNA_TEXT_MAX } from './qna.contract';

/** `POST /api/presentations/:id/qna`. The author comes from the participant token, never from the body. */
export const askQuestionSchema = z
  .object({
    text: z
      .string()
      .transform((value) => value.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1, 'Write a question').max(QNA_TEXT_MAX, `At most ${QNA_TEXT_MAX} characters`)),
    anonymous: z.boolean().default(false),
  })
  .strict();

/** `PATCH /api/presentations/:id/host/qna/:qid` */
export const hostUpdateQuestionSchema = z
  .object({
    status: z.enum(QNA_HOST_STATUSES).optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.pinned !== undefined, {
    message: 'Provide status or pinned',
  });

/** `POST /api/presentations/:id/host/qna/:qid/highlight` — `{highlighted: false}` clears it. */
export const hostHighlightSchema = z.object({ highlighted: z.boolean().default(true) }).strict().default({ highlighted: true });

/** `GET /api/presentations/:id/host/qna?status=` — one status, or every status when absent/`all`. */
export const hostListStatusSchema = z.enum([...QNA_STATUSES, 'all']).default('all');

export type AskQuestionInput = z.infer<typeof askQuestionSchema>;
export type HostUpdateQuestionInput = z.infer<typeof hostUpdateQuestionSchema>;
export type HostHighlightInput = z.infer<typeof hostHighlightSchema>;
export type HostListStatus = z.infer<typeof hostListStatusSchema>;
