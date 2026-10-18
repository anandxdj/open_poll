import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, rejectAnswer, speedScore } from '../ops';
import type { Slide } from '../types';

interface SelectAnswerConfig {
  correctOptions: number[];
  optionCount: number;
  points: number;
  scoreDependsOnTime: boolean;
  timeLimitMs: number;
  /** Present (true) only on multi-select slides, so single-select windows keep their shape. */
  allowMultiple?: true;
}

/**
 * Type settings stored in `slide.config` (null on slides saved before them).
 * - `allowMultiple`: participants pick one or more options; an answer is
 *   correct when the picks equal the correct options exactly.
 * - `explanation`: why the answer is right; never part of the participant slide.
 */
export const selectAnswerSettingsSchema = z.object({
  allowMultiple: z.boolean().default(false),
  explanation: z.string().max(2000).default(''),
});

export type SelectAnswerSettings = z.infer<typeof selectAnswerSettingsSchema>;

export const selectAnswerSettings = (slide: Pick<Slide, 'config'>): SelectAnswerSettings => {
  const config = (slide.config ?? {}) as Partial<SelectAnswerSettings>;
  return {
    allowMultiple: config.allowMultiple === true,
    explanation: typeof config.explanation === 'string' ? config.explanation : '',
  };
};

const answerSchema = z.object({
  optionIndex: z.number().int().optional(),
  optionIndices: z.array(z.number().int()).max(8).optional(),
});

const label = questionLabel('Select answer');

/**
 * Multiple choice with one or more correct options; speed scored. A slide worth
 * 0 points is ungraded (a survey question, e.g. a converted poll) and needs no
 * correct option.
 */
export const selectAnswerSlide = defineSlideType<SelectAnswerConfig, z.infer<typeof answerSchema>>({
  type: 'select_answer',
  name: 'Select answer',
  kind: 'interactive',
  lifecycle: 'response',
  scored: true,
  schema: builtInSlideSchema('select_answer')
    .extend({ config: selectAnswerSettingsSchema.nullable().default(null) })
    .superRefine((slide, ctx) => {
      if (slide.options.length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Select-answer slides need at least 2 options',
        });
      }
      if (slide.points > 0 && !slide.options.some((o) => o.isCorrect)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'Mark at least one option as correct',
        });
      }
    }),
  sanitize: (slide) =>
    selectAnswerSettings(slide).allowMultiple
      ? { ...builtInParticipantFields(slide), allowMultiple: true }
      : builtInParticipantFields(slide),
  acceptConfig: (slide) => ({
    correctOptions: slide.options.flatMap((o, i) => (o.isCorrect ? [i] : [])),
    optionCount: slide.options.length,
    points: slide.points,
    scoreDependsOnTime: slide.scoreDependsOnTime,
    timeLimitMs: slide.timeLimit * 1000,
    ...(selectAnswerSettings(slide).allowMultiple ? { allowMultiple: true as const } : {}),
  }),
  answerSchema,
  accept: (cfg, { optionIndex, optionIndices }) => {
    if (cfg.allowMultiple) {
      const picks = optionIndices ?? (optionIndex !== undefined ? [optionIndex] : []);
      const unique = [...new Set(picks)].sort((a, b) => a - b);
      if (!unique.length || unique.length !== picks.length || unique.some((i) => i < 0 || i >= cfg.optionCount)) {
        rejectAnswer('Invalid options for this slide');
      }
      // correctOptions is built in ascending order, so an element-wise match is set equality.
      const isCorrect =
        cfg.correctOptions.length === unique.length && unique.every((i, n) => cfg.correctOptions[n] === i);
      return {
        isCorrect,
        ops: unique.map((i) => hincrby('dist', String(i))),
        persist: { optionIndex: null, text: null, payload: { optionIndices: unique } },
      };
    }
    if (optionIndex === undefined || optionIndex < 0 || optionIndex >= cfg.optionCount) {
      rejectAnswer('Invalid option for this slide');
    }
    return {
      isCorrect: cfg.correctOptions.includes(optionIndex),
      ops: [hincrby('dist', String(optionIndex))],
      persist: { optionIndex, text: null, payload: null },
    };
  },
  score: (cfg, { isCorrect, elapsedMs }) =>
    speedScore(cfg.points, cfg.scoreDependsOnTime, cfg.timeLimitMs, isCorrect, elapsedMs),
  distribution: (slide, { dist }) => ({
    kind: 'options',
    counts: slide.options.map((_, i) => Number(dist[String(i)] ?? 0)),
    options: slide.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
  }),
  exportColumns: (slide) => [label(slide)],
  exportCells: (slide, answer) => {
    const picks = (answer?.payload as { optionIndices?: unknown } | null | undefined)?.optionIndices;
    if (Array.isArray(picks)) {
      return [picks.map((i) => slide.options[Number(i)]?.text ?? '').filter(Boolean).join(', ') || null];
    }
    return [answer?.optionIndex != null ? (slide.options[answer.optionIndex]?.text ?? null) : null];
  },
  label,
});

registerSlideType(selectAnswerSlide);
