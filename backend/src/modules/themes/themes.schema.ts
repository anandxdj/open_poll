import { z } from 'zod';
import { env } from '../../common/config/env';
import { HEX_COLOR } from './contrast';
import { FONT_CHOICES } from './fonts';

export const hexColor = z
  .string()
  .trim()
  .regex(HEX_COLOR, 'Use a #rrggbb colour')
  .transform((value) => value.toLowerCase());

/** Logos and backgrounds: https (object storage or the customer's site); http only outside production. */
const imageUrl = z
  .string()
  .trim()
  .max(2048)
  .url('Use a full link to the picture')
  .refine((url) => url.startsWith('https://') || (!env.isProduction && url.startsWith('http://')), 'Use an https link');

export const themeColorsSchema = z.strictObject({
  background: hexColor,
  surface: hexColor,
  text: hexColor,
  mutedText: hexColor,
  accent: hexColor,
  accentText: hexColor,
  correct: hexColor,
  incorrect: hexColor,
  chart: z.array(hexColor).min(1, 'Add at least one chart colour').max(12),
});

const fontsSchema = z.strictObject({ heading: z.enum(FONT_CHOICES), body: z.enum(FONT_CHOICES) });
const logoSchema = z.strictObject({ url: imageUrl, alt: z.string().trim().max(120).default('') });
const backgroundSchema = z.strictObject({ imageUrl, overlayOpacity: z.number().min(0).max(0.9) });

/** `POST /api/brand-kits` */
export const createBrandKitSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name the brand kit').max(60),
  colors: themeColorsSchema,
  fonts: fontsSchema,
  logo: logoSchema.nullable().optional(),
  background: backgroundSchema.nullable().optional(),
});

/** `PATCH /api/brand-kits/:id`: any field; colours are replaced whole. */
export const updateBrandKitSchema = createBrandKitSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });

export type CreateBrandKitInput = z.infer<typeof createBrandKitSchema>;
export type UpdateBrandKitInput = z.infer<typeof updateBrandKitSchema>;
