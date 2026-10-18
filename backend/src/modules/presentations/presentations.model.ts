// Barrel for the presentation models (split under models/). Import from here.
import { BUILT_IN_SLIDE_TYPES, isScoredSlideType } from './slides';

export * from './models/presentation.model';
export * from './models/participant.model';
export * from './models/answer.model';

export { isScoredSlideType };

/** Built-in scored types (the registry's `scored` flag is the source of truth). */
export const SCORED_SLIDE_TYPES = BUILT_IN_SLIDE_TYPES.filter((type) => isScoredSlideType(type));
