---
summary: AI module behavior for generating poll drafts, saved polls, quiz drafts and whole decks (outline then slides with speaker notes).
status: active
last_updated: 2026-10-19
---

# AI Module

`modules/ai` converts a structured request (`topic`, `tone`, `questionCount`, plus `isAnonymous` / `expiresAt`) into poll payloads.

## Endpoints
- `POST /api/ai/generate`: generate validated draft payload.
- `POST /api/ai/generate-and-save`: generate draft and persist as a poll owned by the caller.
- `POST /api/ai/generate-quiz`: generate a presentation (slide deck) draft.
- `POST /api/ai/generate-deck`: whole-deck authoring (see below). Creates the deck.

All four require `Authorization: Bearer` and share one rate limit (`ai`, 20 per 5 minutes per
IP). The poll owner always comes from the verified session, never from the request body.

## Guarantees
- Structured output validated by Zod schema aligned with poll create contract.
- Missing Gemini key or model failure falls back to a deterministic mock draft matching `CreatePollInput` shape for frontend testing.

## Whole-deck authoring (`modules/ai/deck/`, W3-F)

`POST /api/ai/generate-deck` — `authenticate()`, the shared `ai` rate limit, `workspaceContext()`.
`assertCan(req, 'deck:create')`; the deck is created in the caller's workspace (`X-Workspace-Id`
or the default one) with `creatorId` from the session. Neither is read from the body.

| File | Role |
| --- | --- |
| `deck.schema.ts` | Request, outline and lenient LLM-output Zod schemas, limits (`DECK_LIMITS`), warning codes. |
| `slideMappers.ts` | `DECK_SLIDE_MAPPERS`: deck kind → registry type, prompt hint, `map()`; `availableKinds()`, `toRegistrySlide()` (registry `safeParse`). |
| `prompts.ts` | Outline / slides / repair prompts; source-text delimiting. |
| `deck.service.ts` | `DeckService.generate`: outline, batched slide generation, repair, create, usage. |
| `llm.ts` | `DeckLlm` client (provider chain from `AiService.invokeStructured`), timeouts, `setDeckLlm()` for tests. |
| `mock.ts` | Deterministic outline and placeholder slides when no AI key is configured. |
| `deck.controller.ts` | 200 for the outline step, 201 for a created deck. |

### Request

```jsonc
{
  "topic": "Zero trust security",      // 3-200 chars, required
  "audience": "new engineers",         // optional, <= 200
  "slideCount": 10,                    // 3-30, default 10
  "tone": "professional",              // professional|casual|educational|inspiring|funny
  "language": "English",               // a language name (letters, spaces, brackets), default English
  "include": { "content": true, "polls": true, "quiz": true },   // at least one
  "sourceText": "",                    // optional pasted material, <= 20,000 chars
  "title": "My deck",                  // optional, wins over the generated title
  "step": "deck",                      // "outline" | "deck" (default)
  "outline": { "title": "...", "sections": [{ "title": "...", "slides": [{ "type": "bullets", "intent": "..." }] }] }
}
```

`outline` (the reviewed/edited outline from step 1) is accepted only with `step: "deck"`; every
`type` must be a deck kind this server offers (400 otherwise).

### Two steps

1. `step: "outline"` -> **200** `{ step:'outline', outline, availableKinds[], warnings[], source }`.
   Nothing is stored and no usage is counted (one model call). The client may let the author edit
   sections, intents and kinds.
2. `step: "deck"` (default) -> **201** `{ step:'deck', presentation, outline, warnings[], source, usage }`.
   With `outline` it writes the slides for that outline; without it, it runs step 1 first. The
   `presentation` is the created **draft deck** in the owner view (speaker notes and answer keys
   included).

### Pipeline

1. Outline (LLM): sections and one `{type, intent}` per slide, normalized: unknown kinds fall back to an
   allowed one, text cleaned, trimmed to `slideCount` (`OUTLINE_TRIMMED` / `OUTLINE_SHORT`). One retry.
2. Slides (LLM): batches of 8 outline positions, 3 batches in parallel, each slide written with
   speaker notes. Extra slides beyond a batch are ignored.
3. Validation and repair, per slide: the generated fields go through the kind's `map()` (clean, cap,
   strip links) and then the **registry type's own `safeParse`**, so a slide that passes is exactly
   what `POST /api/presentations` accepts. A slide that fails (or is missing, or has no notes) gets
   **one targeted re-prompt** (`repair`, with the validation errors and the failed attempt), at most
   10 per deck. Still invalid: **dropped** with a `SLIDE_DROPPED` warning; valid but without notes:
   kept with `SLIDE_WITHOUT_NOTES`. An invalid deck is never returned. If nothing valid is left,
   502 `AI_DECK_EMPTY`; if no model call succeeded, 502 `AI_PROVIDER_FAILED`.
4. The deck is created through `PresentationService.createPresentation` (same schema, workspace
   check and join-code allocation as the REST create), then usage is counted.

### Deck kinds (what the model and the outline may use)

| Kind | Registry type | Category (`include`) |
| --- | --- | --- |
| `heading`, `paragraph`, `bullets`, `quote`, `big_number` | same | content |
| `multiple_choice_quiz` (graded, 1000 pts, 30 s, optional explanation) | `select_answer` | quiz |
| `type_answer` (graded) | `type_answer` | quiz |
| `multiple_choice_poll` (ungraded: 0 pts) | `select_answer` | polls |
| `wordcloud`, `open_ended`, `scales`, `ranking` | same | polls |

A kind is offered only while its registry type is registered (`availableKinds()` reads the registry
at call time). Image, video, instructions and leaderboard slides are not generated (they need
assets or the live engine). Adding a type (e.g. W2-E's advanced types) is one entry in
`DECK_SLIDE_MAPPERS`: `kind`, `type`, `category`, `hint` for the prompt, and `map()`; add a placeholder
case to `mock.ts` and a row to the mapper test.

### Mock mode

Without `LLM_BASE_URL`+`LLM_API_KEY` or `GEMINI_API_KEY` (`capabilities.ai === false`) every step
runs on deterministic placeholders from the topic (`mock.ts`), through the same mappers and registry
validation. The response says **`source: "mock"`**, the speaker notes say they are placeholders, and
`SOURCE_IGNORED` is warned when source text was pasted. Mock decks are free: no usage is counted and
they are not blocked by the quota. `source: "llm"` means a provider produced the text. A provider
failure is an error (502), never a silent fall-back to mock.

### Limits, usage and safety

- Plan quota: counter `ai_deck` (`aiDecksPerMonth`, free 5). It is checked **before** any model call
  (403 `PLAN_LIMIT_REACHED`, `details.limit = 'aiDecksPerMonth'`) and consumed only **after** the deck
  is stored; a concurrent run that took the last unit makes this one delete its deck and fail with the
  same 403. The outline step is never counted. `usage` in the response is the counter after the deck.
- Rate limit: the shared `ai` limiter (20 / 5 min / IP), counted per HTTP call (two per reviewed deck).
- Timeouts: 60 s per model call, 150 s per request; calls are not started with < 3 s left.
- `sourceText` is untrusted data: delimited in a block whose tag carries a random id, look-alike
  delimiters and control/bidi characters are removed, the prompt says to ignore instructions inside
  it, and author text (topic, audience) is passed as JSON. Generated text never keeps links
  (`[x](url)` becomes `x`) and every field is capped (`NOTES_MAX` 2000, slide text by the registry).
- Errors: 400 validation, 401, 403 `FORBIDDEN` / `WORKSPACE_FORBIDDEN` / `PLAN_LIMIT_REACHED`,
  429, 502 `AI_PROVIDER_FAILED` / `AI_DECK_EMPTY`.

### Tests

`tests/ai.deck.{schema,mappers,prompts,service}.test.ts` (unit; `tests/helpers/deckLlm.ts` has
`FakeDeckLlm`) and `tests/integration/aiDeck.test.ts` (real app, mock mode and a fake LLM installed
with `setDeckLlm`). `setDeckLlm(null)` forces mock mode, `setDeckLlm(undefined)` restores the
configured providers.
