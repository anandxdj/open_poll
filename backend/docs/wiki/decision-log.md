---
summary: Concise architecture and implementation decisions by phase.
status: active
last_updated: 2026-05-11
---

# Decision Log

## 2026-05-11
- Adopted room key = `pollId` for creator live analytics subscriptions.
- Chose Redis pub/sub bridge (`responses.accepted`) as source for socket fanout events.
- Kept auth deferred and standardized mocked creator id behavior in controllers.
- Used LangChain structured output + LangGraph node flow for AI draft generation.
- Added always-on Cursor context-router rule to enforce minimal wiki doc loading per task.
- Added `beforeSubmitPrompt` hook to auto-append per-chat prompt log entries in `chat-log.md`.
