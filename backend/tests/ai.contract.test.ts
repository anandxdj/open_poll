import { describe, expect, it } from 'bun:test';
import { generatedPollSchema } from '../src/modules/ai/ai.schema';

describe('ai generated contract', () => {
  it('accepts valid generated poll output', () => {
    const output = generatedPollSchema.parse({
      title: 'AI Generated Poll',
      isAnonymous: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      isPublished: false,
      questions: [
        {
          text: 'Choose one option',
          options: ['A', 'B'],
          isMandatory: true,
        },
      ],
    });

    expect(output.questions.length).toBe(1);
  });
});
