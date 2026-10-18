import { z } from 'zod';
import type { Slide } from './types';

/** Shared Zod fragments for slide type schemas. */

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

/**
 * Request schema for one of the built-in types: required question, a 5–300s
 * timer (the legacy engine always runs one) and the flat legacy fields. Types
 * add their own rules with `.superRefine`.
 */
export const builtInSlideSchema = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    question: z.string().min(1, 'Question text is required').max(500),
    timeLimit: z.number().int().min(5).max(300).default(30),
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
