import type { ThemeFont } from './resolve';

/** The app's own sans (no download). */
export const SYSTEM_FONT = 'System';

/**
 * Fonts a theme may use: the system sans, or one of these Google Fonts
 * families (loaded from fonts.googleapis.com by the live surfaces). A fixed
 * list keeps the CSS URL ours to build and every choice readable on a projector.
 */
export const GOOGLE_FONT_FAMILIES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Work Sans',
  'DM Sans',
  'Source Sans 3',
  'IBM Plex Sans',
  'Space Grotesk',
  'Merriweather',
  'Lora',
  'Playfair Display',
] as const;

export const FONT_CHOICES = [SYSTEM_FONT, ...GOOGLE_FONT_FAMILIES] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

const SYSTEM_STACK = 'ui-sans-serif, system-ui, sans-serif';
const SERIF = new Set<string>(['Merriweather', 'Lora', 'Playfair Display']);

/** The font as live surfaces load it: a CSS stack and, for Google families, the stylesheet URL. */
export function themeFont(choice: FontChoice): ThemeFont {
  if (choice === SYSTEM_FONT) return { family: SYSTEM_STACK, source: 'system', url: null };
  const fallback = SERIF.has(choice) ? 'ui-serif, Georgia, serif' : SYSTEM_STACK;
  const family = encodeURIComponent(choice).replace(/%20/g, '+');
  return {
    family: `"${choice}", ${fallback}`,
    source: 'google',
    url: `https://fonts.googleapis.com/css2?family=${family}:wght@400;600;700&display=swap`,
  };
}
