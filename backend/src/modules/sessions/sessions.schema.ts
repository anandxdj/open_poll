import mongoose from 'mongoose';
import { z } from 'zod';

const objectId = (name: string) =>
  z.string().refine((value) => mongoose.isValidObjectId(value), `${name} must be a valid id`);

/** `GET /api/sessions` query. */
export const listSessionsQuerySchema = z.object({
  presentationId: objectId('presentationId'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;

/** `POST /api/sessions/:sid/share` body. */
export const shareSchema = z
  .object({
    includeNames: z.boolean().optional(),
    /** ISO date; null = never expires; omitted = keep the current expiry. */
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
    /** Issue a new token, invalidating links shared before. */
    rotate: z.boolean().optional(),
  })
  .strict();
export type ShareInput = z.infer<typeof shareSchema>;

/** `GET /api/sessions/:sid/me` query (participant take-home). */
export const takeHomeQuerySchema = z.object({
  participantId: objectId('participantId'),
  token: z.string().min(1).max(200),
});

/** `DELETE /api/sessions/:sid/participants/me` body: the participant removes their own answers. */
export const eraseParticipantSchema = z.object({
  participantId: objectId('participantId'),
  token: z.string().min(1).max(200),
});
