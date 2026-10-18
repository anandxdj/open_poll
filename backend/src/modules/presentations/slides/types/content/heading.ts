import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { contentOf, contentSlideSchema, optionalText, requiredText, textField } from './shared';

const content = z.object({
  title: requiredText(150, 'Heading title is required'),
  subtitle: optionalText(300),
});

/** A title (and optional subtitle): title slides and section openers. */
export const headingSlide = defineSlideType<never, never>({
  type: 'heading',
  name: 'Heading',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('heading', content),
  sanitize: (slide) => {
    const c = contentOf(slide);
    return { content: { title: textField(c.title), subtitle: textField(c.subtitle) } };
  },
  label: (slide) => textField(contentOf(slide).title) || 'Heading',
});

registerSlideType(headingSlide);
