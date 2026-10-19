import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, commonSlideShape, questionLabel } from '../fields';

/** Q&A slides never run a timer and never score, whatever the client sends. */
const always = <T>(value: T, base: z.ZodType) => base.optional().transform(() => value);

/**
 * Q&A board (`board` lifecycle): the host moves to it like a content slide
 * (`slide:shown`, no answer window), the stage shows the session's questions,
 * and while it is on screen participants may ask through the Q&A API even
 * when the deck's Q&A setting is off (`modules/qna`). `question` is the
 * board's optional heading.
 */
export const qnaSlide = defineSlideType<never, never>({
  type: 'qna',
  name: 'Q&A',
  kind: 'interactive',
  lifecycle: 'board',
  scored: false,
  schema: z.object({
    type: z.literal('qna'),
    ...commonSlideShape,
    question: z.string().trim().max(500).default(''),
    timeLimit: always(0, z.number().int().min(0).max(300)),
    points: always(0, z.number().int().min(0).max(10000)),
    scoreDependsOnTime: always(false, z.boolean()),
  }),
  sanitize: builtInParticipantFields,
  label: questionLabel('Q&A'),
});

registerSlideType(qnaSlide);
