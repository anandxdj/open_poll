import { z } from 'zod';
import type { Slide } from './types';

/** Shared Zod fragments for slide type schemas. */

const isHttpUrl = (value: string) => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

export const slideMediaSchema = z.object({
  /** Storage key when the file was uploaded (lets cleanup find it). */
  key: z.string().max(512).nullable().default(null),
  url: z.string().max(2048).refine(isHttpUrl, 'Media URL must be an http(s) URL'),
  alt: z.string().max(500).default(''),
  layout: z.string().max(40).nullable().default(null),
});

/** Fields every slide carries, whatever its type. */
export const commonSlideShape = {
  question: z.string().max(500).default(''),
  /** Speaker notes — host only, never in participant payloads. */
  notes: z.string().max(5000).default(''),
  media: slideMediaSchema.nullable().default(null),
  layout: z.string().max(40).nullable().default(null),
  /** Seconds; 0 = untimed. Types with an answer window require at least 5. */
  timeLimit: z.number().int().min(0).max(300).default(30),
};

export const optionSchema = z.object({
  text: z.string().min(1, 'Option text is required').max(200),
  isCorrect: z.boolean().default(false),
});

/** The flat per-type fields of the seven built-in types (stored as-is, no migration). */
export const legacySlideShape = {
  options: z.array(optionSchema).max(8).default([]),
  acceptedAnswers: z.array(z.string().min(1).max(200)).max(20).default([]),
  statements: z.array(z.string().min(1).max(200)).max(10).default([]),
  minLabel: z.string().max(40).default(''),
  maxLabel: z.string().max(40).default(''),
  scaleMax: z.number().int().min(2).max(10).default(5),
  items: z.array(z.string().min(1).max(200)).max(10).default([]),
  maxEntries: z.number().int().min(1).max(3).default(3),
  points: z.number().int().min(0).max(10000).default(1000),
  scoreDependsOnTime: z.boolean().default(true),
};

/** A timer for unscored slides: 0 = untimed (open until the host closes it), else 5–300s. */
export const untimedOrTimerSchema = z
  .number()
  .int()
  .min(0)
  .max(300)
  .refine((value) => value === 0 || value >= 5, 'Use 0 for an untimed slide or at least 5 seconds')
  .default(30);

/**
 * Request schema for one of the built-in types: required question, the flat
 * legacy fields and a timer. Scored types keep a 5–300s timer (speed scoring
 * needs a deadline); `untimed: true` also allows 0 for unscored types. Types
 * add their own rules with `.superRefine`.
 */
export const builtInSlideSchema = <T extends string>(type: T, options: { untimed?: boolean } = {}) =>
  z.object({
    type: z.literal(type),
    ...commonSlideShape,
    question: z.string().min(1, 'Question text is required').max(500),
    timeLimit: options.untimed ? untimedOrTimerSchema : z.number().int().min(5).max(300).default(30),
    ...legacySlideShape,
  });

/**
 * Participant view of the built-in types. They all share one flat shape (the
 * clients predate the registry), so every built-in type's `sanitize` returns it.
 */
export const builtInParticipantFields = (slide: Slide) => ({
  question: slide.question,
  options: (slide.options ?? []).map((o) => ({ text: o.text })),
  statements: slide.statements ?? [],
  minLabel: slide.minLabel ?? '',
  maxLabel: slide.maxLabel ?? '',
  scaleMax: slide.scaleMax ?? 5,
  items: slide.items ?? [],
  maxEntries: slide.maxEntries ?? 3,
  timeLimit: slide.timeLimit,
  points: slide.points,
  scoreDependsOnTime: slide.scoreDependsOnTime,
});

/** Default `label`: the question, or the type name for slides without one. */
export const questionLabel = (name: string) => (slide: Slide) => slide.question?.trim() || name;
