import type { StageMode } from "./runtime";

/** Shared by the per-type views; values live here so they never import runtime.ts back. */

/** Easing of every chart bar and list entrance. */
export const ease = [0.32, 0.72, 0, 1] as const;

/** True when the stage should draw results as revealed (correct answers highlighted). */
export const isRevealMode = (mode: StageMode) => mode === "reveal" || mode === "report";
