---
summary: AI module behavior for generating poll drafts and saved polls.
status: active
last_updated: 2026-10-18
---

# AI Module

`modules/ai` converts a structured request (`topic`, `tone`, `questionCount`, plus `isAnonymous` / `expiresAt`) into poll payloads.

## Endpoints
- `POST /api/ai/generate`: generate validated draft payload.
- `POST /api/ai/generate-and-save`: generate draft and persist as a poll owned by the caller.
- `POST /api/ai/generate-quiz`: generate a presentation (slide deck) draft.

All three require `Authorization: Bearer` and share one rate limit (`ai`, 20 per 5 minutes per
IP). The poll owner always comes from the verified session, never from the request body.

## Guarantees
- Structured output validated by Zod schema aligned with poll create contract.
- Missing Gemini key or model failure falls back to a deterministic mock draft matching `CreatePollInput` shape for frontend testing.
