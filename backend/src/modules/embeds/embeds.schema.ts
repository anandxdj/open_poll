import { z } from 'zod';
import { EMBED_KINDS } from './policy.service';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** POST /api/embeds/screen-tokens */
export const createScreenTokenSchema = z.strictObject({
  presentationId: objectId,
  label: z.string().trim().min(1, 'Name the screen').max(80, 'Keep the name under 80 characters'),
});

/** GET /api/embeds/screen-tokens */
export const listScreenTokensQuery = z.object({ presentationId: objectId });

/** GET /api/embeds/policy (the frontend proxy, before it serves an embed page) */
export const embedPolicyQuery = z.object({
  kind: z.enum(EMBED_KINDS),
  id: z.string().min(1).max(200),
  token: z.string().max(200).optional(),
});

const size = z.coerce.number().int().positive().optional();

/** GET /api/oembed (oEmbed 1.0: `url`, `format`, `maxwidth`, `maxheight`) */
export const oembedQuery = z.object({
  url: z.string().min(1, 'url is required').max(2048),
  format: z.string().optional(),
  maxwidth: size,
  maxheight: size,
});

export type CreateScreenTokenInput = z.infer<typeof createScreenTokenSchema>;
