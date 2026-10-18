import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, rejectAnswer } from '../ops';

interface RankingConfig {
  itemCount: number;
}

const answerSchema = z.object({ ranking: z.array(z.number().int()).max(10).optional() });

const label = questionLabel('Ranking');

const rankingOf = (payload: unknown): unknown[] => {
  const ranking = (payload as { ranking?: unknown } | null)?.ranking;
  return Array.isArray(ranking) ? ranking : [];
};

/** A full ordering of the items, Borda counted: top = n points … last = 1. */
export const rankingSlide = defineSlideType<RankingConfig, z.infer<typeof answerSchema>>({
  type: 'ranking',
  name: 'Ranking',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: builtInSlideSchema('ranking', { untimed: true }).superRefine((slide, ctx) => {
    if (slide.items.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Ranking slides need at least 2 items',
      });
    }
  }),
  sanitize: builtInParticipantFields,
  acceptConfig: (slide) => ({ itemCount: slide.items?.length ?? 0 }),
  answerSchema,
  accept: (cfg, { ranking }) => {
    if (!ranking || ranking.length !== cfg.itemCount) {
      rejectAnswer('Rank every item');
    }
    const unique = new Set(ranking);
    if (unique.size !== cfg.itemCount || ranking.some((i) => i < 0 || i >= cfg.itemCount)) {
      rejectAnswer('Invalid ranking order');
    }
    return {
      isCorrect: false,
      ops: [
        ...ranking.map((itemIndex, position) => hincrby('dist', String(itemIndex), cfg.itemCount - position)),
        hincrby('dist', 'voters'),
      ],
      persist: { optionIndex: null, text: null, payload: { ranking } },
    };
  },
  distribution: (slide, { dist }) => {
    const ranked = (slide.items ?? []).map((text, i) => ({ text, points: Number(dist[String(i)] ?? 0) }));
    return {
      kind: 'ranking',
      items: ranked.sort((a, b) => b.points - a.points).map((item, i) => ({ ...item, rank: i + 1 })),
      voters: Number(dist['voters'] ?? 0),
    };
  },
  exportColumns: (slide) => [label(slide)],
  exportCells: (slide, answer) => {
    if (!answer) return [null];
    const items = slide.items ?? [];
    return [
      rankingOf(answer.payload)
        .map((i) => (typeof i === 'number' ? items[i] : undefined))
        .filter((text): text is string => text !== undefined)
        .join(' > '),
    ];
  },
  label,
});

registerSlideType(rankingSlide);
