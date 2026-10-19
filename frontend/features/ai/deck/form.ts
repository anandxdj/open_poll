import { DECK_LIMITS, type DeckInclude, type DeckOutline, type DeckRequest, type DeckTone } from "./types";

/** The whole-deck form as the author fills it in. */
export interface DeckForm {
  topic: string;
  audience: string;
  slideCount: number;
  tone: DeckTone;
  language: string;
  include: DeckInclude;
  sourceText: string;
}

export const defaultForm = (topic = ""): DeckForm => ({
  topic,
  audience: "",
  slideCount: DECK_LIMITS.defaultSlides,
  tone: "professional",
  language: "English",
  include: { content: true, polls: true, quiz: true },
  sourceText: "",
});

export type FormErrorCode = "topicShort" | "topicLong" | "audienceLong" | "languageInvalid" | "sourceLong" | "includeNone";
export type FormErrors = Partial<Record<"topic" | "audience" | "language" | "sourceText" | "include", FormErrorCode>>;

// Same rule as the backend: a language name, not free text that could carry instructions.
const LANGUAGE_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} ()-]*$/u;

export function validateForm(form: DeckForm): FormErrors {
  const errors: FormErrors = {};
  const topic = form.topic.trim();
  if (topic.length < DECK_LIMITS.topicMin) errors.topic = "topicShort";
  else if (topic.length > DECK_LIMITS.topicMax) errors.topic = "topicLong";
  if (form.audience.trim().length > DECK_LIMITS.audienceMax) errors.audience = "audienceLong";
  const language = form.language.trim();
  if (
    language.length < DECK_LIMITS.languageMin ||
    language.length > DECK_LIMITS.languageMax ||
    !LANGUAGE_PATTERN.test(language)
  ) {
    errors.language = "languageInvalid";
  }
  if (form.sourceText.trim().length > DECK_LIMITS.sourceTextMax) errors.sourceText = "sourceLong";
  if (!form.include.content && !form.include.polls && !form.include.quiz) errors.include = "includeNone";
  return errors;
}

export const isFormValid = (form: DeckForm) => Object.keys(validateForm(form)).length === 0;

/**
 * The request for a step. `title` (the name the author already gave the deck)
 * only goes with the outline step: the reviewed outline carries the final title.
 */
export function toRequest(
  form: DeckForm,
  step: DeckRequest["step"],
  extra: { title?: string; outline?: DeckOutline } = {}
): DeckRequest {
  const request: DeckRequest = {
    topic: form.topic.trim(),
    audience: form.audience.trim(),
    slideCount: Math.min(DECK_LIMITS.maxSlides, Math.max(DECK_LIMITS.minSlides, Math.round(form.slideCount))),
    tone: form.tone,
    language: form.language.trim(),
    include: { ...form.include },
    sourceText: form.sourceText.trim(),
    step,
  };
  const title = extra.title?.trim();
  if (step === "outline" && title) request.title = title.slice(0, DECK_LIMITS.titleMax);
  if (step === "deck" && extra.outline) request.outline = extra.outline;
  return request;
}
