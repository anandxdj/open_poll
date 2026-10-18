import { defineSlideType, registerSlideType } from '../registry';
import { builtInParticipantFields, builtInSlideSchema, questionLabel } from '../fields';

/** Mid-deck standings: no timer, no answers, rendered from the live scores. */
export const leaderboardSlide = defineSlideType<never, never>({
  type: 'leaderboard',
  name: 'Leaderboard',
  kind: 'system',
  lifecycle: 'system',
  scored: false,
  schema: builtInSlideSchema('leaderboard', { untimed: true }),
  sanitize: builtInParticipantFields,
  label: questionLabel('Leaderboard'),
});

registerSlideType(leaderboardSlide);
