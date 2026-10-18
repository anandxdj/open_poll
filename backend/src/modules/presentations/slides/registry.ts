import { ApiError } from '../../../common/utils/ApiError';
import type { AnySlideTypeDef, SlideKind, SlideTypeDef, Slide } from './types';

const registry = new Map<string, AnySlideTypeDef>();

/** Identity helper that type-checks a def's config/payload generics. */
export const defineSlideType = <Cfg, Payload>(def: SlideTypeDef<Cfg, Payload>) => def;

/**
 * Adds a type to the registry. Returns a disposer that removes it again (used by
 * tests that register fixture types). Registering a taken key throws.
 */
export const registerSlideType = (def: AnySlideTypeDef): (() => void) => {
  if (registry.has(def.type)) {
    throw new Error(`Slide type "${def.type}" is already registered`);
  }
  registry.set(def.type, def);
  return () => {
    if (registry.get(def.type) === def) registry.delete(def.type);
  };
};

export const getSlideType = (type: unknown): AnySlideTypeDef | undefined =>
  typeof type === 'string' ? registry.get(type) : undefined;

export const hasSlideType = (type: unknown) => getSlideType(type) !== undefined;

/** Lookup for stored slides; an unregistered type cannot be run. */
export const requireSlideType = (type: unknown): AnySlideTypeDef => {
  const def = getSlideType(type);
  if (!def) throw ApiError.badRequest(`Unsupported slide type "${String(type)}"`);
  return def;
};

/** Registered types in registration order. */
export const listSlideTypes = (): AnySlideTypeDef[] => [...registry.values()];

export const isScoredSlideType = (type: unknown) => getSlideType(type)?.scored ?? false;

export const slideKindOf = (type: unknown): SlideKind | undefined => getSlideType(type)?.kind;

const sanitizeMedia = (media: Slide['media']) =>
  media && media.url
    ? { url: media.url, alt: media.alt ?? '', layout: media.layout ?? null }
    : null;

/**
 * The participant-facing payload for one slide: the type's explicit allow-list
 * plus the registry-owned envelope. Used by `question:started`, `slide:shown`
 * and the join-code lookup, so all three agree.
 */
export const toParticipantSlide = (slide: Slide, slideIndex: number, totalSlides: number) => {
  const def = requireSlideType(slide.type);
  return {
    ...def.sanitize(slide),
    slideIndex,
    totalSlides,
    type: def.type,
    kind: def.kind,
    scored: def.scored,
    media: sanitizeMedia(slide.media),
    layout: slide.layout ?? null,
  };
};
