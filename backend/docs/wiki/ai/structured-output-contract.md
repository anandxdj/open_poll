---
summary: Structured schema contract for AI-generated poll payloads.
status: active
last_updated: 2026-10-19
---

# Structured Output Contract

AI output must satisfy:
- `title` string, minimum 3 chars
- `isAnonymous` boolean
- `expiresAt` future date string
- `isPublished` boolean (default false)
- `questions[]` where each question has:
  - `text` string
  - `options[]` with at least 2 non-empty options
  - `isMandatory` boolean

This contract is validated in `modules/ai/ai.schema.ts` and reused before persistence.

## Deck generation contract (`modules/ai/deck/deck.schema.ts`)

Whole-deck authoring uses a deliberately **lenient** model-facing contract and a strict stored one.

- **Outline** (`llmOutlineSchema`): `{title, sections[{title, slides[{type, intent}]}]}`. The `type`
  description lists the deck kinds the server offers. The service normalizes it (`DeckOutline`:
  known kinds only, trimmed, <= 30 slides, <= 12 sections, intent <= 300 chars) before use; the same
  `deckOutlineSchema` validates an outline an author edited and sends back.
- **Slides** (`llmSlidesSchema` -> `llmSlideSchema`): one flat object whose every field is optional
  (`title, subtitle, body, items, text, attribution, value, prefix, suffix, label, question, options,
  explanation, acceptedAnswers, statements, minLabel, maxLabel, notes`). The deck kind decides
  which fields matter (its prompt hint says so). A structured-output parse failure would lose a
  whole batch of slides, while a loose shape lets each slide fail on its own.
- **Stored slide**: `slideMappers.ts` builds a request-shaped slide from the flat object (cleaned
  and capped text, links stripped, `points`/`timeLimit` set per kind) and the **registry type's
  `schema.safeParse`** validates it. `speaker notes` go in `slide.notes` (<= 2000 chars generated;
  5000 stored limit), never into participant payloads.
- **Response** `DeckWarning { code: 'SLIDE_DROPPED' | 'SLIDE_WITHOUT_NOTES' | 'OUTLINE_SHORT' |
  'OUTLINE_TRIMMED' | 'SOURCE_IGNORED', message, position? }` and `source: 'llm' | 'mock'`.

See `backend/docs/wiki/modules/ai.md` for the endpoint, pipeline and error codes.
