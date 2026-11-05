import { z } from 'zod';
import { THEME_MODES } from '../themes/presets';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

/** createPresentationSchema's title limit. */
const title = z.string().trim().min(1, 'Give it a name').max(120, 'Use at most 120 characters');

/** `POST /api/templates`: save a deck of the workspace as a template. */
export const saveTemplateSchema = z.object({ presentationId: objectId, title: title.optional() }).strict();

/**
 * `POST /api/templates/:id/use`: optional title for the new deck (default: the
 * template's) and light or dark (the app theme the creator uses; default: a
 * workspace template's own, light for a starter).
 */
export const useTemplateSchema = z.object({ title: title.optional(), themeMode: z.enum(THEME_MODES).optional() }).strict().default({});

export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;
export type UseTemplateInput = z.infer<typeof useTemplateSchema>;
