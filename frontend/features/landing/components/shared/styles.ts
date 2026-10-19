/**
 * Class recipes shared by the landing sections and the auth pages, so every
 * marketing surface uses the same gutters, buttons and section rhythm.
 */

const motion = "transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]";

/** Page gutters: 20px on phones, 24px from `sm`, 32px from `lg`. */
export const container = "mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8";

/** Vertical rhythm between landing sections. */
export const sectionY = "py-20 sm:py-24 lg:py-28";

const buttonBase = `mk-focus inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-2xl font-semibold ${motion} active:translate-y-px active:scale-[0.98]`;

export const button = {
  /** Sandy-tan call to action; 44px tall (48px for `lg`). */
  primary: `${buttonBase} h-11 bg-primary px-5 text-sm text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-105`,
  primaryLg: `${buttonBase} h-12 bg-primary px-6 text-base text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-105`,
  /** Quiet outlined button. */
  secondary: `${buttonBase} h-11 border border-foreground/15 bg-foreground/[0.03] px-5 text-sm text-foreground hover:bg-foreground/[0.07]`,
  secondaryLg: `${buttonBase} h-12 border border-foreground/15 bg-foreground/[0.03] px-6 text-base text-foreground hover:bg-foreground/[0.07]`,
  /** Text-only link in the header. */
  ghost: `${buttonBase} h-11 px-4 text-sm font-medium text-muted-foreground hover:text-foreground`,
} as const;

/** Inline text link that stays readable on both themes. */
export const textLink =
  "mk-focus rounded-sm font-medium text-brand-ink underline-offset-4 transition-colors duration-300 hover:underline";
