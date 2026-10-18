import { blankSlide } from "../../slides/editor";
import type { PresentationSlide, PresentationSlideType } from "../../types/deck";

// Pure slide-rail operations. Each takes the slide list plus the selected
// index and returns both, so the selection always follows the edit.

export interface RailState {
  slides: PresentationSlide[];
  active: number;
}

const inRange = (slides: PresentationSlide[], index: number) =>
  Number.isInteger(index) && index >= 0 && index < slides.length;

/** New blank slide of `type` appended to the deck and selected. */
export function addSlide({ slides }: RailState, type: PresentationSlideType): RailState {
  return { slides: [...slides, blankSlide(type)], active: slides.length };
}

/** Moves the slide at `from` to `to`; the selection stays on the slide it was on. */
export function moveSlide(state: RailState, from: number, to: number): RailState {
  const { slides, active } = state;
  if (from === to || !inRange(slides, from) || !inRange(slides, to)) return state;

  const next = [...slides];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  let nextActive = active;
  if (active === from) nextActive = to;
  else if (from < active && to >= active) nextActive = active - 1;
  else if (from > active && to <= active) nextActive = active + 1;

  return { slides: next, active: nextActive };
}

/** Deep copy without the server id (the API assigns a new one on save). */
export function cloneSlide(slide: PresentationSlide): PresentationSlide {
  const copy = structuredClone(slide);
  delete copy._id;
  return copy;
}

/** Inserts a copy right after `index` and selects the copy. */
export function duplicateSlide(state: RailState, index: number): RailState {
  const { slides } = state;
  if (!inRange(slides, index)) return state;
  return {
    slides: [...slides.slice(0, index + 1), cloneSlide(slides[index]), ...slides.slice(index + 1)],
    active: index + 1,
  };
}

/** Removes the slide at `index`; a deck always keeps at least one slide. */
export function removeSlide(state: RailState, index: number): RailState {
  const { slides, active } = state;
  if (slides.length <= 1 || !inRange(slides, index)) return state;
  const next = slides.filter((_, j) => j !== index);
  return {
    slides: next,
    active: Math.max(0, active > index ? active - 1 : Math.min(active, next.length - 1)),
  };
}
