import { z } from 'zod';
import { defineSlideType, registerSlideType } from '../../registry';
import { boolField, contentOf, contentSlideSchema, optionalText, textField, truncate } from './shared';

const content = z.object({
  /** Show the join QR code on the stage. */
  showQr: z.boolean().default(true),
  /** Show the join address and code on the stage. */
  showCode: z.boolean().default(true),
  /** Extra instructions under the join details. */
  text: optionalText(300),
});

/** "How to join": the join address, code and QR, mid-deck. */
export const instructionsSlide = defineSlideType<never, never>({
  type: 'instructions',
  name: 'Instructions',
  kind: 'content',
  lifecycle: 'content',
  scored: false,
  schema: contentSlideSchema('instructions', content),
  sanitize: (slide) => {
    const c = contentOf(slide);
    return {
      content: { showQr: boolField(c.showQr, true), showCode: boolField(c.showCode, true), text: textField(c.text) },
    };
  },
  label: (slide) => truncate(textField(contentOf(slide).text)) || 'How to join',
});

registerSlideType(instructionsSlide);
