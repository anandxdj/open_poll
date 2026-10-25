import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';
import { hincrby, hsetnx, normalizeText, rejectAnswer } from '../ops';

const answerSchema = z.object({ text: z.string().max(500).optional() });

const label = questionLabel('Open ended');

/** One free-text response per participant, grouped by normalized text; never scored. */
export const openEndedSlide = defineSlideType<null, z.infer<typeof answerSchema>>({
  type: 'open_ended',
  name: 'Open ended',
  kind: 'interactive',
  lifecycle: 'response',
  scored: false,
  schema: builtInSlideSchema('open_ended', { untimed: true }),
  sanitize: builtInParticipantFields,
  answerSchema,
  accept: (_cfg, { text }) => {
    if (text === undefined) rejectAnswer('This slide expects a typed response');
    const normalized = normalizeText(text);
    return {
      isCorrect: false,
      ops: [hincrby('dist', normalized), hsetnx('disp', normalized, text.trim())],
      persist: { optionIndex: null, text, payload: null },
    };
  },
  distribution: (_slide, { dist, disp }) => ({
    kind: 'responses',
    responses: Object.entries(dist)
      .map(([norm, count]) => ({ text: disp[norm] ?? norm, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
  }),
  exportColumns: (slide) => [label(slide)],
  exportCells: (_slide, answer) => [answer?.text ?? null],
  label,
});

registerSlideType(openEndedSlide);
