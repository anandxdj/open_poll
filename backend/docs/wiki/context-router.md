---
summary: Minimal-context routing guide for loading only required docs per task.
status: active
last_updated: 2026-10-19
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

### Unified library, poll → deck conversion, legacy quiz copy (migration 010)
- `backend/docs/wiki/modules/library.md`

### Response validation and analytics tasks
- `backend/docs/wiki/modules/responses.md`
- `backend/docs/wiki/api/responses.md`

### Live presentation deck tasks (slides, scoring, leaderboard, participants)
- `backend/docs/wiki/modules/presentations.md`
- `backend/docs/wiki/modules/presentations-live.md` (sessions, slide phases, host/participant API, events — the live contract)
- `backend/docs/wiki/quiz-roadmap.md` (phases / what to build next)
- Add `backend/docs/wiki/realtime/presentations.md` only if touching events.

### Audience Q&A, upvotes, moderation, highlight, emoji reactions, the `qna` slide
- `backend/docs/wiki/modules/qna.md` (API, settings, limits, Redis keys, coalescing)
- Add `backend/docs/wiki/realtime/qna.md` only if touching events or the `reaction:send` socket message.

### Realtime Socket/Redis tasks
- `backend/docs/wiki/realtime/envelope.md` (core: registry, auth, envelope, rooms, delivery)
- `backend/docs/wiki/realtime/presentations.md` or `realtime/polls.md` (the module you touch)
- `backend/docs/wiki/realtime/redis-channels.md`

### HTTP app, middleware order and route mounting tasks
- `backend/docs/wiki/http/app-and-routes.md` (app factory, special mounts, mount table, route snapshot)

### Integration tests, fixtures and dependency spikes
- `backend/docs/wiki/testing/integration.md`
- Add `backend/docs/wiki/http/app-and-routes.md` only if the test touches mounts or middleware.

### AI generation tasks
- `backend/docs/wiki/modules/ai.md`
- `backend/docs/wiki/ai/structured-output-contract.md`
- `backend/docs/wiki/ai/prompting-and-graph-flow.md`

### Workspaces API, poll tenancy, migration 020
- `backend/docs/wiki/modules/workspaces.md`
- Add `backend/docs/wiki/platform/tenancy.md` only if changing the policy or workspace context.

### Platform primitives (load only the one you touch)
- Workspaces, roles, `assertCan`, workspace context, provider identities: `backend/docs/wiki/platform/tenancy.md`
- Plans, entitlements, usage quotas, `GET /api/capabilities`, env feature groups: `backend/docs/wiki/platform/plans.md`
- Object storage and `/api/uploads`: `backend/docs/wiki/platform/storage.md`
- Scheduled jobs: `backend/docs/wiki/platform/jobs.md`
- Migrations (`bun run migrate`): `backend/docs/wiki/platform/migrations.md`
- Audit events, secret encryption: `backend/docs/wiki/platform/audit-and-crypto.md`

### Setup and readiness tasks
- `backend/docs/wiki/setup/local-dev.md`
- `backend/docs/wiki/mvp-checklist.md`

## Hard rule
- Do not preload all wiki docs.
- Load only one task branch at a time.
- Add docs only if blocked by missing context.
