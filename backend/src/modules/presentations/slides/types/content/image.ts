import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import {
  IMAGE_EXTENSIONS,
  httpsUrlSchema,
  mediaUrlOf,
  publicUrlOf,
  storageDisabledMessage,
  storageKeySchema,
} from './media';
import { contentOf, contentSlideSchema, optionalText, requiredText, textField } from './shared';

export const IMAGE_FITS = ['contain', 'cover'] as const;

const content = z
  .object({
    /** Storage key of an uploaded image (`POST /api/uploads/presign` + `/complete`). */
    key: storageKeySchema(IMAGE_EXTENSIONS, 'Not an uploaded image'),
    /** Pasted image address; replaced by the storage URL when `key` is set. */
    url: httpsUrlSchema('Image URL must start with https://'),
    alt: requiredText(500, 'Alt text is required: describe the image for people who cannot see it'),
    fit: z.enum(IMAGE_FITS).default('contain'),
    caption: optionalText(300),
  })
  .superRefine((image, ctx) => {
    if (image.key && !publicUrlOf(image.key)) {
      ctx.addIssue({ code: 'custom', path: ['key'], message: storageDisabledMessage });
    }
  })
  // An upload is served from storage: the URL always follows the key. With
  // neither a key nor a URL the slide is a placeholder (drafts, outlines).
  .transform((image) => (image.key ? { ...image, url: publicUrlOf(image.key) } : image));

/** One image with required alt text, a fit mode and an optional caption. */
export const imageSlide = defineSlideType<never, never>({
  type: 'image',
  name: 'Image',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('image', content),
  // The storage key never leaves the server; participants get the URL only.
  sanitize: (slide) => {
    const c = contentOf(slide);
    const fit = IMAGE_FITS.find((f) => f === c.fit) ?? 'contain';
    return {
      content: { url: mediaUrlOf(slide), alt: textField(c.alt), fit, caption: textField(c.caption) },
    };
  },
  label: (slide) => {
    const c = contentOf(slide);
    return textField(c.caption) || textField(c.alt) || 'Image';
  },
});

registerSlideType(imageSlide);
