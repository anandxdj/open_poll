import type { PresentationSlide, SelectAnswerConfig } from "../../../types/deck";

// Reads select_answer settings; shared by the editor and the stage, so it stays
// free of editor and runtime code. Mirrors the backend's `selectAnswerSettings`.

/** Backend limit on `config.explanation`. */
export const MAX_EXPLANATION_LENGTH = 2000;

/** `slide.config` with defaults filled in (null on slides saved before the settings existed). */
export function selectAnswerConfig(slide: Pick<PresentationSlide, "config">): SelectAnswerConfig {
  const config = slide.config ?? {};
  return {
    allowMultiple: config.allowMultiple === true,
    explanation: typeof config.explanation === "string" ? config.explanation : "",
  };
}

/** A select_answer slide worth points has correct options; one worth 0 is a survey question. */
export const isGradedSelectAnswer = (slide: Pick<PresentationSlide, "points">) => slide.points > 0;
