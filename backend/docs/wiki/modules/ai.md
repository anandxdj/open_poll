---
summary: AI module behavior for generating poll drafts and saved polls.
status: active
last_updated: 2026-05-11
---

# AI Module

`modules/ai` converts natural-language instructions into poll payloads.

## Endpoints
- `POST /api/ai/generate`: generate validated draft payload.
- `POST /api/ai/generate-and-save`: generate draft and persist as poll.

## Guarantees
- Structured output validated by Zod schema aligned with poll create contract.
- Missing Gemini key or model failure falls back to a deterministic mock draft matching `CreatePollInput` shape for frontend testing.
