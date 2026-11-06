import type { LiveSlide } from "../types";
import type { StageMode } from "./runtime";
import { isGradedSelectAnswer } from "./types/select_answer/config";

/** Shared by the per-type views; values live here so they never import runtime.ts back. */

/** Easing of every chart bar and list entrance. */
export const ease = [0.32, 0.72, 0, 1] as const;

/** True when the stage should draw results as revealed (correct answers highlighted). */
/**
 * Props of a stage view's results box that scrolls when it overflows (many
 * options, a long explanation, 200% zoom): focusable and named after the
 * slide, so the keyboard can scroll it (WCAG 2.1.1, W4-A). Thumbnails are
 * pictures inside an aria-hidden rail: nothing focusable there.
 */
export const stageScrollProps = (mode: StageMode, label: string) =>
  mode === "thumbnail" ? {} : ({ tabIndex: 0, role: "group", "aria-label": label } as const);

export const isRevealMode = (mode: StageMode) => mode === "reveal" || mode === "report";

/**
 * Whether a participant's answer comes back right or wrong. Scored types are,
 * except a select_answer slide worth 0 points: a survey question (e.g. a
 * converted poll) with no correct option.
 */
export const isGradedSlide = (slide: Pick<LiveSlide, "type" | "scored" | "points">) =>
  slide.scored && (slide.type !== "select_answer" || isGradedSelectAnswer(slide));
