import type { LiveSlide } from "../types";
import type { StageMode } from "./runtime";
import { isGradedSelectAnswer } from "./types/select_answer/config";

/** Shared by the per-type views; values live here so they never import runtime.ts back. */

/** Easing of every chart bar and list entrance. */
export const ease = [0.32, 0.72, 0, 1] as const;

/** True when the stage should draw results as revealed (correct answers highlighted). */
export const isRevealMode = (mode: StageMode) => mode === "reveal" || mode === "report";

/**
 * Whether a participant's answer comes back right or wrong. Scored types are,
 * except a select_answer slide worth 0 points: a survey question (e.g. a
 * converted poll) with no correct option.
 */
export const isGradedSlide = (slide: Pick<LiveSlide, "type" | "scored" | "points">) =>
  slide.scored && (slide.type !== "select_answer" || isGradedSelectAnswer(slide));
