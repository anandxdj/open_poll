import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, rejectAnswer } from '../ops';

interface ScalesConfig {
  statementCount: number;
  scaleMax: number;
}

const answerSchema = z.object({ ratings: z.array(z.number().int()).max(10).optional() });

const label = questionLabel('Scales');

const ratingsOf = (payload: unknown): unknown[] => {
  const ratings = (payload as { ratings?: unknown } | null)?.ratings;
  return Array.isArray(ratings) ? ratings : [];
};

/** One 1..scaleMax rating per statement; results are per-statement averages. */
export const scalesSlide = defineSlideType<ScalesConfig, z.infer<typeof answerSchema>>({
  type: 'scales',
  name: 'Scales',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: builtInSlideSchema('scales', { untimed: true }).superRefine((slide, ctx) => {
    if (slide.statements.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['statements'],
        message: 'Scales slides need at least one statement',
      });
    }
  }),
  sanitize: builtInParticipantFields,
  acceptConfig: (slide) => ({
    statementCount: slide.statements?.length ?? 0,
    scaleMax: slide.scaleMax ?? 5,
  }),
  answerSchema,
  accept: (cfg, { ratings }) => {
    if (!ratings || ratings.length !== cfg.statementCount) {
      rejectAnswer('Rate every statement');
    }
    if (ratings.some((r) => r < 1 || r > cfg.scaleMax)) {
      rejectAnswer(`Ratings must be between 1 and ${cfg.scaleMax}`);
    }
    return {
      isCorrect: false,
      ops: ratings.flatMap((rating, i) => [hincrby('dist', `s${i}:sum`, rating), hincrby('dist', `s${i}:count`)]),
      persist: { optionIndex: null, text: null, payload: { ratings } },
    };
  },
  distribution: (slide, { dist }) => ({
    kind: 'scales',
    statements: (slide.statements ?? []).map((statement, i) => {
      const sum = Number(dist[`s${i}:sum`] ?? 0);
      const count = Number(dist[`s${i}:count`] ?? 0);
      return {
        statement,
        average: count > 0 ? Math.round((sum / count) * 100) / 100 : 0,
        count,
      };
    }),
    scaleMax: slide.scaleMax ?? 5,
    minLabel: slide.minLabel ?? '',
    maxLabel: slide.maxLabel ?? '',
  }),
  exportColumns: (slide) => (slide.statements ?? []).map((statement) => `${label(slide)} — ${statement}`),
  exportCells: (slide, answer) => {
    const ratings = answer ? ratingsOf(answer.payload) : [];
    return (slide.statements ?? []).map((_, i) => (typeof ratings[i] === 'number' ? ratings[i] : null));
  },
  label,
});

registerSlideType(scalesSlide);
