import { z } from 'zod';
import { BUILT_IN_SLIDE_TYPES, getSlideType, listSlideTypes, type ParsedSlide } from './slides';

/** The built-in slide types, in their historical order (AI drafting offers these). */
export const PRESENTATION_SLIDE_TYPES = BUILT_IN_SLIDE_TYPES;

/**
 * One slide in a create/update request. Dispatches on `type` to the registered
 * type's own schema at parse time, so types registered later (content types,
 * test fixtures) validate without rebuilding this schema. Issues keep the
 * type schema's paths, prefixed by the slide's position.
 */
export const presentationSlideSchema = z
  .object({ type: z.unknown() })
  .loose()
  .transform((slide, ctx): ParsedSlide => {
    const def = getSlideType(slide.type);
    if (!def) {
      ctx.addIssue({
        code: 'custom',
        path: ['type'],
        message: `Invalid option: expected one of ${listSlideTypes()
          .map((d) => `"${d.type}"`)
          .join('|')}`,
      });
      return z.NEVER;
    }
    const result = def.schema.safeParse(slide);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ ...issue });
      return z.NEVER;
    }
    return result.data;
  });

export const createPresentationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  slides: z.array(presentationSlideSchema).min(1, 'A presentation deck needs at least one slide').max(50),
});

export const updatePresentationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  slides: z.array(presentationSlideSchema).min(1).max(50).optional(),
});

export const joinPresentationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(30),
  // Server-signed device token from a previous join — enables refresh-safe
  // rejoin. Absent or invalid → the server mints a fresh identity.
  deviceToken: z.string().max(256).optional(),
});

export const submitPresentationAnswerSchema = z
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
    // Generic answer for any registered type, validated by the type's `answerSchema`.
    // When present it is used instead of the legacy fields above.
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      v.optionIndex !== undefined ||
      v.text !== undefined ||
      v.entries !== undefined ||
      v.ratings !== undefined ||
      v.ranking !== undefined ||
      v.payload !== undefined,
    { message: 'Provide an answer payload' }
  );

export type CreatePresentationInput = z.infer<typeof createPresentationSchema>;
export type UpdatePresentationInput = z.infer<typeof updatePresentationSchema>;
export type JoinPresentationInput = z.infer<typeof joinPresentationSchema>;
export type SubmitPresentationAnswerInput = z.infer<typeof submitPresentationAnswerSchema>;
