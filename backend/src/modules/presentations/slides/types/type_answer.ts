import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, normalizeText, rejectAnswer, speedScore } from '../ops';
import type { Slide } from '../types';

interface TypeAnswerConfig {
  acceptedNormalized: string[];
  points: number;
  scoreDependsOnTime: boolean;
  timeLimitMs: number;
}

const answerSchema = z.object({ text: z.string().max(500).optional() });

const label = questionLabel('Type answer');

/** Graded: worth points and has an accepted answer. Otherwise no score and no answer revealed. */
const isGraded = (slide: Pick<Slide, 'points' | 'acceptedAnswers'>) =>
  (slide.points == null || slide.points > 0) && (slide.acceptedAnswers ?? []).length > 0;

/** Free-text answer matched case/whitespace-insensitively; speed scored. */
export const typeAnswerSlide = defineSlideType<TypeAnswerConfig, z.infer<typeof answerSchema>>({
  type: 'type_answer',
  name: 'Type answer',
  kind: 'interactive',
  lifecycle: 'response',
  scored: true,
  isScored: isGraded,
  schema: builtInSlideSchema('type_answer').superRefine((slide, ctx) => {
    if (slide.acceptedAnswers.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['acceptedAnswers'],
        message: 'Type-answer slides need at least one accepted answer',
      });
    }
  }),
  sanitize: builtInParticipantFields,
  acceptConfig: (slide) => ({
    acceptedNormalized: slide.acceptedAnswers.map((a) => normalizeText(a)),
    points: slide.points,
    scoreDependsOnTime: slide.scoreDependsOnTime,
    timeLimitMs: slide.timeLimit * 1000,
  }),
  answerSchema,
  accept: (cfg, { text }) => {
    if (text === undefined) rejectAnswer('This slide expects a typed answer');
    const normalized = normalizeText(text);
    return {
      isCorrect: cfg.acceptedNormalized.includes(normalized),
      ops: [hincrby('dist', normalized)],
      persist: { optionIndex: null, text, payload: null },
    };
  },
  score: (cfg, { isCorrect, elapsedMs }) =>
    speedScore(cfg.points, cfg.scoreDependsOnTime, cfg.timeLimitMs, isCorrect, elapsedMs),
  distribution: (slide, { dist }) => {
    const graded = isGraded(slide);
    const accepted = graded ? (slide.acceptedAnswers || []).map(normalizeText) : [];
    const answers = Object.entries(dist)
      .map(([text, count]) => ({ text, count: Number(count), isCorrect: accepted.includes(text) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return { kind: 'text', answers, acceptedAnswers: graded ? slide.acceptedAnswers : [] };
  },
  exportColumns: (slide) => [label(slide)],
  exportCells: (_slide, answer) => [answer?.text ?? null],
  label,
});

registerSlideType(typeAnswerSlide);
