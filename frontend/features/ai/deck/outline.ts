import { DECK_LIMITS, type DeckKindInfo, type DeckOutline, type DeckOutlineSlide } from "./types";

// Pure edits of an outline the author is reviewing. Every function returns a
// new outline; sections left without slides disappear (the API needs >= 1).

export const countSlides = (outline: DeckOutline) =>
  outline.sections.reduce((total, section) => total + section.slides.length, 0);

export const setOutlineTitle = (outline: DeckOutline, title: string): DeckOutline => ({ ...outline, title });

export const setSectionTitle = (outline: DeckOutline, section: number, title: string): DeckOutline => ({
  ...outline,
  sections: outline.sections.map((s, i) => (i === section ? { ...s, title } : s)),
});

export const updateSlide = (
  outline: DeckOutline,
  section: number,
  index: number,
  patch: Partial<DeckOutlineSlide>
): DeckOutline => ({
  ...outline,
  sections: outline.sections.map((s, i) =>
    i === section ? { ...s, slides: s.slides.map((slide, j) => (j === index ? { ...slide, ...patch } : slide)) } : s
  ),
});

const dropEmptySections = (outline: DeckOutline): DeckOutline => ({
  ...outline,
  sections: outline.sections.filter((s) => s.slides.length > 0),
});

export const removeSlide = (outline: DeckOutline, section: number, index: number): DeckOutline =>
  dropEmptySections({
    ...outline,
    sections: outline.sections.map((s, i) => (i === section ? { ...s, slides: s.slides.filter((_, j) => j !== index) } : s)),
  });

/** Appends a slide to a section; no-op at the slide limit. */
export const addSlide = (outline: DeckOutline, section: number, kind: string): DeckOutline =>
  countSlides(outline) >= DECK_LIMITS.maxSlides
    ? outline
    : {
        ...outline,
        sections: outline.sections.map((s, i) => (i === section ? { ...s, slides: [...s.slides, { type: kind, intent: "" }] } : s)),
      };

/** Moves a slide one place up (-1) or down (1); at a section edge it crosses into the neighbouring section. */
export function moveSlide(outline: DeckOutline, section: number, index: number, direction: -1 | 1): DeckOutline {
  const current = outline.sections[section];
  if (!current || !current.slides[index]) return outline;
  const slide = current.slides[index]!;
  const target = index + direction;

  if (target >= 0 && target < current.slides.length) {
    const slides = [...current.slides];
    slides[index] = slides[target]!;
    slides[target] = slide;
    return { ...outline, sections: outline.sections.map((s, i) => (i === section ? { ...s, slides } : s)) };
  }

  const neighbour = section + direction;
  if (neighbour < 0 || neighbour >= outline.sections.length) return outline;
  return dropEmptySections({
    ...outline,
    sections: outline.sections.map((s, i) => {
      if (i === section) return { ...s, slides: s.slides.filter((_, j) => j !== index) };
      if (i === neighbour) return { ...s, slides: direction < 0 ? [...s.slides, slide] : [slide, ...s.slides] };
      return s;
    }),
  });
}

export type OutlineIssue =
  | { code: "title" }
  | { code: "section"; section: number }
  | { code: "intent"; section: number; index: number; number: number }
  | { code: "empty" }
  | { code: "tooMany" };

/** What blocks "write the slides"; an empty list means the outline can be sent. */
export function validateOutline(outline: DeckOutline): OutlineIssue[] {
  const issues: OutlineIssue[] = [];
  if (!outline.title.trim()) issues.push({ code: "title" });
  const total = countSlides(outline);
  if (total === 0) issues.push({ code: "empty" });
  if (total > DECK_LIMITS.maxSlides) issues.push({ code: "tooMany" });
  let number = 0;
  outline.sections.forEach((section, s) => {
    if (!section.title.trim()) issues.push({ code: "section", section: s });
    section.slides.forEach((slide, index) => {
      number += 1;
      if (!slide.intent.trim()) issues.push({ code: "intent", section: s, index, number });
    });
  });
  return issues;
}

/** The outline as the API wants it back: trimmed and capped. */
export const cleanOutline = (outline: DeckOutline): DeckOutline => ({
  title: outline.title.trim().slice(0, DECK_LIMITS.titleMax),
  sections: outline.sections.map((section) => ({
    title: section.title.trim().slice(0, DECK_LIMITS.sectionTitleMax),
    slides: section.slides.map((slide) => ({ type: slide.type, intent: slide.intent.trim().slice(0, DECK_LIMITS.intentMax) })),
  })),
});

/** Position of a slide in the whole deck (1-based), for labels. */
export const slideNumber = (outline: DeckOutline, section: number, index: number) =>
  outline.sections.slice(0, section).reduce((total, s) => total + s.slides.length, 0) + index + 1;

/** Kinds that exist in a response's `availableKinds`, plus the slide's own kind if the server dropped it. */
export const kindOptions = (kinds: readonly DeckKindInfo[], current: string): string[] => {
  const list = kinds.map((k) => k.kind);
  return list.includes(current) ? list : [current, ...list];
};
