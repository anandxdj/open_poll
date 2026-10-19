import type { z } from 'zod';
import { AiService } from '../ai.service';

/**
 * The structured-output client whole-deck generation talks to. In production it
 * is the AI module's provider chain (OpenAI-compatible proxy, then Gemini);
 * without any key there is no client and the service builds a labelled mock deck.
 * Tests install a fake with `setDeckLlm`.
 */

export type DeckLlmTask = 'outline' | 'slides' | 'repair';

export interface DeckLlm {
  readonly name: string;
  /** Resolves with output parsed by `schema`, or rejects (provider error, parse failure, timeout). */
  generate<T>(schema: z.ZodType<T>, prompt: string, options: { task: DeckLlmTask; timeoutMs: number }): Promise<T>;
}

export class DeckLlmTimeoutError extends Error {
  constructor(task: DeckLlmTask, timeoutMs: number) {
    super(`AI ${task} call timed out after ${timeoutMs}ms`);
    this.name = 'DeckLlmTimeoutError';
  }
}

/** Rejects after `timeoutMs`; the underlying call is abandoned (the provider has its own timeout too). */
export const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, task: DeckLlmTask): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeckLlmTimeoutError(task, timeoutMs)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

const providerChain: DeckLlm = {
  name: 'provider-chain',
  generate: (schema, prompt, { task, timeoutMs }) => withTimeout(AiService.invokeStructured(schema, prompt), timeoutMs, task),
};

/** `undefined` = use the configured providers; `null` = force mock; a client = use it. */
let override: DeckLlm | null | undefined;

/** Replaces the client (tests). Pass `undefined` to restore the configured providers. */
export const setDeckLlm = (llm: DeckLlm | null | undefined) => {
  override = llm;
};

/** The client to use for this request, or null when no AI provider is configured (mock mode). */
export const resolveDeckLlm = (): DeckLlm | null => {
  if (override !== undefined) return override;
  return AiService.hasModel() ? providerChain : null;
};
