import { z } from 'zod';

export const submitResponseSchema = z.object({
  pollId: z.string().min(1, 'pollId is required'),
  // Server-issued signed ballot token (see POST /responses/poll/:pollId/ballot).
  ballotToken: z.string().min(32, 'ballotToken is required').max(256),
  // Legacy client hint only — never used as a trust anchor.
  deviceId: z.string().max(100).optional(),
  // Server-issued signed guest token (see POST /responses/guest-token).
  guestToken: z.string().max(512).optional(),
  answers: z.array(
    z.object({
      questionId: z.string().min(1, 'questionId is required'),
      selectedOptionIndex: z.number().int().min(0),
    }),
  ).min(1, 'At least one answer is required'),
});

export const issueGuestTokenSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  email: z.string().trim().email('Valid email is required').max(120),
});

export type SubmitResponseInput = z.infer<typeof submitResponseSchema> & {
  // Derived server-side from the authenticated session — never from the body.
  authenticatedUserId?: string;
};
export type IssueGuestTokenInput = z.infer<typeof issueGuestTokenSchema>;
