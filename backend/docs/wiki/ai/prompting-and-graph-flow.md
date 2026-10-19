---
summary: LangChain + LangGraph flow for AI poll generation, and the outline/slides/repair prompts of whole-deck authoring.
status: active
last_updated: 2026-10-19
---

# Prompting and Graph Flow

The AI path uses `ChatGoogleGenerativeAI` with structured output and a LangGraph state flow.

Graph steps:
1. Start with request fields: `topic`, `tone`, `questionCount` (and pass-through `isAnonymous`, `expiresAt`).
2. `generatePoll` node uses a persona system prompt so the model produces exactly `questionCount` single-option multiple-choice questions in the requested tone.
3. Output is normalized with request-level `isAnonymous` and `expiresAt`.
4. Zod parse enforces final contract.

This keeps LLM generation deterministic enough for backend API usage.

## Whole-deck prompts (`modules/ai/deck/prompts.ts`)

Deck generation does not use the LangGraph poll flow. `llm.ts` calls
`AiService.invokeStructured(schema, prompt)` (the provider chain: OpenAI-compatible proxy, then
Gemini) once per prompt, each under its own timeout:

1. **Outline prompt**: request JSON, rules (exactly `slideCount` slides, 2-6 sections, only the offered
   kinds with their hints, language, tone), optional source block.
2. **Slides prompt** (per batch of <= 8 positions): request JSON, the outline, the batch as JSON, the
   hints of only the kinds in the batch, shared rules (notes on every slide, plain text, no links),
   optional source block.
3. **Repair prompt** (one slide): the slide position/intent, the kind hint, the validation errors from
   the registry schema, and a capped copy (<= 4000 chars) of the failed attempt.

Everything the author typed is data: topic, audience, tone and language travel as one JSON object
(language is restricted to a language name by the request schema). Pasted `sourceText` sits in
`<source_material id="<random>">...</source_material id="<random>">`, after the rules, with
instructions to treat it as untrusted data; look-alike tags and control characters are stripped
(`neutralizeSourceText`).
