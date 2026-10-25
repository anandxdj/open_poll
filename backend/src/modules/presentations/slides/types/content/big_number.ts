import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { contentOf, contentSlideSchema, numberField, optionalText, textField } from './shared';

/** Largest magnitude a big number may have (keeps formatting exact). */
export const BIG_NUMBER_LIMIT = 1e15;

const content = z.object({
  value: z
    .number({ error: 'Enter the number to show' })
    .finite()
    .min(-BIG_NUMBER_LIMIT)
    .max(BIG_NUMBER_LIMIT),
  label: optionalText(150),
  /** Shown before the number, e.g. `$`. */
  prefix: optionalText(12),
  /** Shown after the number, e.g. `%` or `M`. */
  suffix: optionalText(12),
});

/** One headline figure with a label, e.g. "87% of teams…". */
export const bigNumberSlide = defineSlideType<never, never>({
  type: 'big_number',
  name: 'Big number',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('big_number', content),
  sanitize: (slide) => {
    const c = contentOf(slide);
    return {
      content: {
        value: numberField(c.value, 0),
        label: textField(c.label),
        prefix: textField(c.prefix),
        suffix: textField(c.suffix),
      },
    };
  },
  label: (slide) => {
    const c = contentOf(slide);
    const figure = `${textField(c.prefix)}${numberField(c.value, 0)}${textField(c.suffix)}`;
    const text = textField(c.label);
    return text ? `${figure} ${text}` : figure;
  },
});

registerSlideType(bigNumberSlide);
