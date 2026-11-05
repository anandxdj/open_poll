import type { ContrastFailure, ThemeColors } from "./types";

/** Mirror of the backend's WCAG checks (`modules/themes/contrast.ts`) for live feedback while editing. */

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) return 1;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export const CONTRAST_RULES: { foreground: ContrastFailure["foreground"]; background: ContrastFailure["background"]; minimum: number }[] = [
  { foreground: "text", background: "background", minimum: 4.5 },
  { foreground: "text", background: "surface", minimum: 4.5 },
  { foreground: "mutedText", background: "background", minimum: 4.5 },
  { foreground: "accentText", background: "accent", minimum: 4.5 },
  { foreground: "accent", background: "background", minimum: 3 },
  { foreground: "correct", background: "background", minimum: 3 },
  { foreground: "incorrect", background: "background", minimum: 3 },
];

export function contrastFailures(colors: ThemeColors): ContrastFailure[] {
  return CONTRAST_RULES.flatMap((rule) => {
    const ratio = contrastRatio(colors[rule.foreground], colors[rule.background]);
    return ratio + 1e-9 < rule.minimum ? [{ ...rule, ratio: Math.round(ratio * 100) / 100 }] : [];
  });
}

export const COLOR_LABELS: Record<ContrastFailure["foreground"], string> = {
  background: "Stage",
  surface: "Panels",
  text: "Text",
  mutedText: "Secondary text",
  accent: "Accent",
  accentText: "Text on accent",
  correct: "Correct",
  incorrect: "Incorrect",
};

/** "Text on Stage: 3.2:1, needs 4.5:1". */
export const describeFailure = (f: ContrastFailure) =>
  `${COLOR_LABELS[f.foreground]} on ${COLOR_LABELS[f.background]}: ${f.ratio.toFixed(1)}:1, needs ${f.minimum}:1`;
