import { buttonVariants } from "@/components/ui/button";

/**
 * Layout recipes shared by the landing sections and the sign-in pages.
 * Buttons are the app's own `Button` variants, so marketing and product agree.
 */

/** Page gutters 16 / 24 / 32 and the 1200px content width. */
export const container = "mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8";

/** Vertical rhythm between landing sections. */
export const sectionY = "py-20 md:py-28";

/** Links that look like buttons (`<Link className={linkButton()}>`). */
export const linkButton = buttonVariants;

/** Inline text link that stays readable on both themes. */
export const textLink =
  "rounded-sm font-medium text-accent-ink underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
