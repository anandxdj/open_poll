---
summary: LangChain + LangGraph flow for AI poll generation.
status: active
last_updated: 2026-05-11
---

# Prompting and Graph Flow

The AI path uses `ChatGoogleGenerativeAI` with structured output and a LangGraph state flow.

Graph steps:
1. Start with request fields: `topic`, `tone`, `questionCount` (and pass-through `isAnonymous`, `expiresAt`).
2. `generatePoll` node uses a persona system prompt so the model produces exactly `questionCount` single-option multiple-choice questions in the requested tone.
3. Output is normalized with request-level `isAnonymous` and `expiresAt`.
4. Zod parse enforces final contract.

This keeps LLM generation deterministic enough for backend API usage.
