import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { contentOf, contentSlideSchema, optionalText, requiredText, textField, textList } from './shared';

export const MAX_BULLETS = 10;

const content = z.object({
  title: optionalText(150),
  items: z
    .array(requiredText(200, 'Bullet text is required'))
    .min(1, 'Add at least one bullet')
    .max(MAX_BULLETS, `Bullet lists hold up to ${MAX_BULLETS} items`),
});

/** An optional title over up to ten bullet points. */
export const bulletsSlide = defineSlideType<never, never>({
  type: 'bullets',
  name: 'Bullet list',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('bullets', content),
  sanitize: (slide) => {
    const c = contentOf(slide);
    return { content: { title: textField(c.title), items: textList(c.items).slice(0, MAX_BULLETS) } };
  },
  label: (slide) => {
    const c = contentOf(slide);
    return textField(c.title) || textList(c.items)[0] || 'Bullet list';
  },
});

registerSlideType(bulletsSlide);
