---
summary: Structured schema contract for AI-generated poll payloads.
status: active
last_updated: 2026-05-11
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
