import { z } from 'zod';
import { BUILT_IN_SLIDE_TYPES, getSlideType, listSlideTypes, type ParsedSlide } from './slides';
import {
  MAX_REACTION_EMOJIS,
  NICKNAME_MODES,
  RESULTS_VISIBILITY,
  SESSION_PACES,
} from './models/presentation.model';

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

const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/**
 * Deck settings in requests: every field optional. Create fills the rest with
 * the model defaults; update changes only the fields sent.
 */
export const deckSettingsPatchSchema = z
  .object({
    audienceLocale: z.string().min(2).max(10),
    nickname: z.enum(NICKNAME_MODES),
    showResultsOnDevices: z.boolean(),
    qna: z
      .object({ enabled: z.boolean(), moderation: z.boolean(), anonymousAllowed: z.boolean(), upvotes: z.boolean() })
      .partial()
      .strict(),
    reactions: z
      .object({
        enabled: z.boolean(),
        emojis: z.array(z.string().min(1).max(16)).max(MAX_REACTION_EMOJIS),
      })
      .partial()
      .strict(),
    quiz: z.object({ leaderboard: z.boolean(), showCorrectOnDevices: z.boolean() }).partial().strict(),
    audiencePaced: z
      .object({
        resultsVisibility: z.enum(RESULTS_VISIBILITY),
        assessment: z
          .object({
            enabled: z.boolean(),
            passingScorePercentage: z.number().int().min(0).max(100),
            maxAttempts: z.number().int().min(1).max(10).nullable(),
          })
          .partial()
          .strict(),
      })
      .partial()
      .strict(),
    embed: z.object({ allowed: z.boolean() }).partial().strict(),
  })
  .partial()
  .strict();

const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour')
  .transform((value) => value.toLowerCase());

/**
 * Theme selection (W3-A): a preset, optionally a brand kit of the deck's
 * workspace (plan feature `brand_kits`), and an accent override. The service
 * checks the preset, the kit and the override's contrast.
 */
export const deckThemePatchSchema = z
  .object({
    presetId: z.string().min(1).max(40),
    brandKitId: objectIdString.nullable(),
    overrides: z.object({ accent: hexColor, accentText: hexColor }).partial().strict().nullable(),
  })
  .partial()
  .strict();

export const createPresentationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  slides: z.array(presentationSlideSchema).min(1, 'A presentation deck needs at least one slide').max(50),
  pace: z.enum(SESSION_PACES).optional(),
  settings: deckSettingsPatchSchema.optional(),
  theme: deckThemePatchSchema.optional(),
});

export const updatePresentationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  slides: z.array(presentationSlideSchema).min(1).max(50).optional(),
  pace: z.enum(SESSION_PACES).optional(),
  settings: deckSettingsPatchSchema.optional(),
  theme: deckThemePatchSchema.optional(),
});

export const joinPresentationSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(30),
  // Server-signed device token from a previous join — enables refresh-safe
  // rejoin. Absent or invalid → the server mints a fresh identity.
  deviceToken: z.string().max(256).optional(),
  locale: z.string().min(2).max(10).optional(),
});

/** `POST /:id/host/goto`: one of the two. */
export const gotoSlideSchema = z
  .object({
    slideIndex: z.number().int().min(0).optional(),
    slideId: objectIdString.optional(),
  })
  .refine((v) => v.slideIndex !== undefined || v.slideId !== undefined, {
    message: 'Provide slideIndex or slideId',
  });

/** `POST /:id/host/advance` (legacy): an optional target index, default the next slide. */
export const advanceSlideSchema = z.object({ slideIndex: z.number().int().min(0).optional() }).default({});

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
    // Session-aware clients name the session and slide; legacy clients send slideIndex only.
    sessionId: objectIdString.optional(),
    slideId: objectIdString.optional(),
    // Client-generated idempotency id, stored with the answer.
    clientAnswerId: z.string().min(1).max(64).optional(),
    // HMAC proof the client saw the slide open (question:started / live-state): lets a late
    // answer through the grace window. Anything malformed is simply not a valid ticket.
    slideTicket: z.string().max(80).optional(),
    // The client held this answer offline before sending it (stored as `via: 'offline'`).
    offline: z.boolean().optional(),
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
export type GotoSlideInput = z.infer<typeof gotoSlideSchema>;
