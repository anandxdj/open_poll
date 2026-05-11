---
summary: Copy-paste instructions to force minimal essential context in new chats.
status: active
last_updated: 2026-05-11
---

# How To Run Limited Context

Use this starter instruction in every new chat:

```text
Use controlled context mode.
First read only: backend/docs/wiki/context-router.md
Then read only the exact docs mapped to my task type.
Do not read unrelated docs.
Keep responses concise and implementation-focused.
If contracts changed, update only the impacted wiki pages and append one line to backend/docs/wiki/chat-log.md.
```

## Minimal task labels you can give
- `polls`
- `responses`
- `realtime`
- `ai`
- `setup`

Example:

```text
Task type: ai
Goal: update AI prompt and structured output validation only.
```
