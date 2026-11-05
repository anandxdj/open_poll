import { getSlideType } from '../presentations/slides';
import type { IPresentationSlide } from '../presentations/models/presentation.model';
import type { ISlideState } from '../presentations/models/session.model';

/**
 * What a screen (W4-D) may see of a deck. A screen token can end up on a public
 * web page, so the stage it gets must not hand out what the host console keeps
 * to itself until the reveal: speaker notes never, answer keys only for slides
 * already revealed. Everything here is pure; `stage.service.ts` applies it.
 */

/**
 * Fields of a result distribution that carry the answer key, and what they
 * become before the reveal. Every built-in response type reports its key
 * through one of these (`select_answer` options' `isCorrect`, `type_answer`
 * `acceptedAnswers` and answers' `isCorrect`, `guess_number` `correct`,
 * `tolerance` and `correctCount`, `pin_on_image` `region` and `inRegion`); a
 * new type that adds a different one must add it here
 * (`tests/embeds.stageSafe.test.ts` runs every registered response type).
 */
const DISTRIBUTION_KEY_FIELDS: Record<string, unknown> = {
  isCorrect: false,
  acceptedAnswers: [],
  correct: null,
  tolerance: null,
  correctCount: null,
  region: null,
  inRegion: null,
};

/** A copy of `value` with every answer-key field replaced by its neutral value, at any depth. */
export const stripAnswerKeys = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => stripAnswerKeys(item)) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = Object.hasOwn(DISTRIBUTION_KEY_FIELDS, key) ? DISTRIBUTION_KEY_FIELDS[key] : stripAnswerKeys(inner);
  }
  return out as T;
};

type PlainSlide = Omit<Partial<IPresentationSlide>, '_id'> & { _id?: unknown; type: string };

/**
 * One deck slide as a screen may see it. Notes always go. A response slide not
 * yet revealed in the session the screen follows keeps its question, options,
 * statements, items and timing, but loses its answer key: options are all
 * marked wrong, accepted answers are emptied, and `config`/`content` are the
 * type's participant allow-list (`sanitize`), so an advanced type's correct
 * value or area never leaves the server. `select_answer` keeps `allowMultiple`
 * (the stage needs it to count shares) but not its explanation.
 */
export const stageSafeSlide = (slide: PlainSlide, revealed: boolean): PlainSlide => {
  const withoutNotes: PlainSlide = { ...slide, notes: '' };
  const def = getSlideType(slide.type);
  if (!def || def.lifecycle !== 'response' || revealed) return withoutNotes;

  const safe = def.sanitize(slide as unknown as IPresentationSlide) as Record<string, unknown>;
  return {
    ...withoutNotes,
    options: (slide.options ?? []).map((option) => ({ ...option, isCorrect: false })),
    acceptedAnswers: [],
    config: Object.hasOwn(safe, 'config') ? safe.config : safe.allowMultiple === true ? { allowMultiple: true } : null,
    content: Object.hasOwn(safe, 'content') ? safe.content : (slide.content ?? null),
  };
};

/** Whether the session's state for a slide says its results were revealed. */
export const isRevealed = (state: Pick<ISlideState, 'revealedAt'> | null | undefined) => Boolean(state?.revealedAt);
