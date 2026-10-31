/**
 * WCAG 2.1 contrast checks for theme colours. A theme is used on a projector
 * and on phones, so text must reach AA (4.5:1) and the accent and the
 * correct/incorrect marks must stand out from the stage (3:1, non-text).
 */

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastColors {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  correct: string;
  incorrect: string;
}

export interface ContrastFailure {
  /** The colour drawn on top. */
  foreground: keyof ContrastColors;
  /** The colour under it. */
  background: keyof ContrastColors;
  ratio: number;
  minimum: number;
}

const RULES: { foreground: keyof ContrastColors; background: keyof ContrastColors; minimum: number }[] = [
  { foreground: 'text', background: 'background', minimum: 4.5 },
  { foreground: 'text', background: 'surface', minimum: 4.5 },
  { foreground: 'mutedText', background: 'background', minimum: 4.5 },
  { foreground: 'accentText', background: 'accent', minimum: 4.5 },
  { foreground: 'accent', background: 'background', minimum: 3 },
  { foreground: 'correct', background: 'background', minimum: 3 },
  { foreground: 'incorrect', background: 'background', minimum: 3 },
];

/** Every pair below its minimum, ratios rounded to two decimals; empty when the palette passes. */
export function contrastFailures(colors: ContrastColors): ContrastFailure[] {
  return RULES.flatMap((rule) => {
    const ratio = contrastRatio(colors[rule.foreground], colors[rule.background]);
    return ratio + 1e-9 < rule.minimum ? [{ ...rule, ratio: Math.round(ratio * 100) / 100 }] : [];
  });
}
