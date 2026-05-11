---
summary: LangChain + LangGraph flow for AI poll generation.
status: active
last_updated: 2026-05-11
---

# Prompting and Graph Flow

The AI path uses `ChatGoogleGenerativeAI` with structured output and a LangGraph state flow.

Graph steps:
1. Start with request prompt.
2. `generatePoll` node asks model to produce a single-option multiple-choice poll payload.
3. Output is normalized with request-level `isAnonymous` and `expiresAt`.
4. Zod parse enforces final contract.

This keeps LLM generation deterministic enough for backend API usage.
