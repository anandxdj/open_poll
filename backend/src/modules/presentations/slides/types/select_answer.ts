import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, rejectAnswer, speedScore } from '../ops';

interface SelectAnswerConfig {
  correctOptions: number[];
  optionCount: number;
  points: number;
  scoreDependsOnTime: boolean;
  timeLimitMs: number;
}

const answerSchema = z.object({ optionIndex: z.number().int().optional() });

const label = questionLabel('Select answer');

/** Multiple choice with one or more correct options; speed scored. */
export const selectAnswerSlide = defineSlideType<SelectAnswerConfig, z.infer<typeof answerSchema>>({
  type: 'select_answer',
  name: 'Select answer',
  kind: 'interactive',
  lifecycle: 'response',
  scored: true,
  schema: builtInSlideSchema('select_answer').superRefine((slide, ctx) => {
    if (slide.options.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Select-answer slides need at least 2 options',
      });
    }
    if (!slide.options.some((o) => o.isCorrect)) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Mark at least one option as correct',
      });
    }
  }),
  sanitize: builtInParticipantFields,
  acceptConfig: (slide) => ({
    correctOptions: slide.options.flatMap((o, i) => (o.isCorrect ? [i] : [])),
    optionCount: slide.options.length,
    points: slide.points,
    scoreDependsOnTime: slide.scoreDependsOnTime,
    timeLimitMs: slide.timeLimit * 1000,
  }),
  answerSchema,
  accept: (cfg, { optionIndex }) => {
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
  exportCells: (slide, answer) => [
    answer?.optionIndex != null ? (slide.options[answer.optionIndex]?.text ?? null) : null,
  ],
  label,
});

registerSlideType(selectAnswerSlide);
