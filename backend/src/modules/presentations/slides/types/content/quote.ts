import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { contentOf, contentSlideSchema, optionalText, requiredText, textField, truncate } from './shared';

const content = z.object({
  text: requiredText(500, 'Quote text is required'),
  attribution: optionalText(150),
});

/** A quotation with an optional attribution. */
export const quoteSlide = defineSlideType<never, never>({
  type: 'quote',
  name: 'Quote',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('quote', content),
  sanitize: (slide) => {
    const c = contentOf(slide);
    return { content: { text: textField(c.text), attribution: textField(c.attribution) } };
  },
  label: (slide) => truncate(textField(contentOf(slide).text)) || 'Quote',
});

registerSlideType(quoteSlide);
