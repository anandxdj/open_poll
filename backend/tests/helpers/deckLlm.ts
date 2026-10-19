import type { z } from 'zod';
import type { DeckLlm, DeckLlmTask } from '../../src/modules/ai/deck/llm';
import type { GeneratedSlide, LlmOutline } from '../../src/modules/ai/deck/deck.schema';

export interface LlmCall {
  task: DeckLlmTask;
  prompt: string;
  timeoutMs: number;
}

type Handler = (call: LlmCall, index: number) => unknown;

/**
 * A fake structured-output client for the deck pipeline. `handlers` answer per task
 * (a handler may throw or return a promise); every call is recorded in `calls`.
 * Outputs are returned as-is (not parsed): the service must cope with whatever shape
 * comes back.
 */
export class FakeDeckLlm implements DeckLlm {
  readonly name = 'fake';
  readonly calls: LlmCall[] = [];
  constructor(private readonly handlers: Partial<Record<DeckLlmTask, Handler>>) {}

  callsFor(task: DeckLlmTask) {
    return this.calls.filter((call) => call.task === task);
  }

  async generate<T>(_schema: z.ZodType<T>, prompt: string, options: { task: DeckLlmTask; timeoutMs: number }): Promise<T> {
    const call: LlmCall = { prompt, ...options };
    const index = this.callsFor(options.task).length;
    this.calls.push(call);
    const handler = this.handlers[options.task];
    if (!handler) throw new Error(`FakeDeckLlm: no handler for ${options.task}`);
    return (await handler(call, index)) as T;
  }
}

/** A well-formed generated slide per deck kind, with speaker notes. */
export const validGenerated = (kind: string, n = 1): GeneratedSlide => {
  const notes = `Say something about slide ${n}.`;
  switch (kind) {
    case 'heading':
      return { title: `Title ${n}`, subtitle: 'A subtitle', notes };
    case 'paragraph':
      return { title: `Idea ${n}`, body: 'One short paragraph.', notes };
    case 'bullets':
      return { title: `Points ${n}`, items: ['One', 'Two', 'Three'], notes };
    case 'quote':
      return { text: 'Simplicity is the ultimate sophistication.', attribution: 'Leonardo da Vinci', notes };
    case 'big_number':
      return { value: 42, suffix: '%', label: 'of examples are made up', notes };
    case 'multiple_choice_quiz':
      return {
        question: `Quiz ${n}?`,
        options: [
          { text: 'Right', isCorrect: true },
          { text: 'Wrong', isCorrect: false },
          { text: 'Also wrong', isCorrect: false },
        ],
        explanation: 'Because.',
        notes,
      };
    case 'type_answer':
      return { question: `Type it ${n}`, acceptedAnswers: ['yes'], notes };
    case 'multiple_choice_poll':
      return {
        question: `Poll ${n}?`,
        options: [
          { text: 'A', isCorrect: false },
          { text: 'B', isCorrect: false },
        ],
        notes,
      };
    case 'wordcloud':
      return { question: `One word ${n}?`, notes };
    case 'open_ended':
      return { question: `Thoughts ${n}?`, notes };
    case 'scales':
      return { question: `Rate ${n}`, statements: ['I get it'], minLabel: 'No', maxLabel: 'Yes', notes };
    case 'ranking':
      return { question: `Order ${n}`, items: ['x', 'y', 'z'], notes };
    default:
      throw new Error(`validGenerated: unknown kind ${kind}`);
  }
};

/** An outline as the model would return it. */
export const llmOutline = (kinds: string[], title = 'Generated deck'): LlmOutline => ({
  title,
  sections: [
    {
      title: 'Part one',
      slides: kinds.map((type, i) => ({ type, intent: `Slide ${i + 1} intent` })),
    },
  ],
});

/** Reads the delimited "SLIDES TO WRITE" JSON out of a slides prompt. */
export const slidesInPrompt = (prompt: string): { position: number; type: string; intent: string }[] => {
  const marker = 'SLIDES TO WRITE (JSON):\n';
  const start = prompt.indexOf(marker) + marker.length;
  return JSON.parse(prompt.slice(start, prompt.indexOf('\n', start)));
};
