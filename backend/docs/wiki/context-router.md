---
summary: Minimal-context routing guide for loading only required docs per task.
status: active
last_updated: 2026-10-18
---

# Context Router

Read this file first in every new chat. Then load only the mapped docs for the current task.

## Core baseline (always allowed)
- `backend/docs/wiki/project-overview.md`
- `backend/docs/wiki/api-conventions.md`

## Route by task type

### Poll lifecycle and assessment (`TRIAL`) tasks
- `backend/docs/wiki/modules/polls.md`
- `backend/docs/wiki/api/polls.md`

### Response validation and analytics tasks
- `backend/docs/wiki/modules/responses.md`
- `backend/docs/wiki/api/responses.md`

### Live presentation deck tasks (slides, scoring, leaderboard, participants)
- `backend/docs/wiki/modules/presentations.md`
- `backend/docs/wiki/quiz-roadmap.md` (phases / what to build next)
- Add `backend/docs/wiki/realtime/socket-events.md` only if touching events.

### Realtime Socket/Redis tasks
- `backend/docs/wiki/realtime/socket-events.md`
- `backend/docs/wiki/realtime/redis-channels.md`

### AI generation tasks
- `backend/docs/wiki/modules/ai.md`
- `backend/docs/wiki/ai/structured-output-contract.md`
- `backend/docs/wiki/ai/prompting-and-graph-flow.md`

### Setup and readiness tasks
- `backend/docs/wiki/setup/local-dev.md`
- `backend/docs/wiki/mvp-checklist.md`

## Hard rule
- Do not preload all wiki docs.
- Load only one task branch at a time.
- Add docs only if blocked by missing context.
