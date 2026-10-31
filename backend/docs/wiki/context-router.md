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

### Imports: PPTX, PDF, Google Slides (queued jobs), CSV/XLSX question files, the import worker
- `backend/docs/wiki/modules/imports.md`
- Add `backend/docs/wiki/platform/storage.md` only if touching uploads, `platform/jobs.md` only for the scheduler (the import queue has its own worker).

### Response validation and analytics tasks
- `backend/docs/wiki/modules/responses.md`
- `backend/docs/wiki/api/responses.md`

### Live presentation deck tasks (slides, scoring, leaderboard, participants)
- `backend/docs/wiki/modules/presentations.md`
- `backend/docs/wiki/modules/presentations-live.md` (sessions, slide phases, host/participant API, events — the live contract)
- `backend/docs/wiki/quiz-roadmap.md` (phases / what to build next)
- Add `backend/docs/wiki/realtime/presentations.md` only if touching events.
- Answer hot path (Lua script, replays, grace/tickets, coalescer, write-behind, auto-reveal, socket `answer:submit`/`live:resync`): the "Answer path" section of `modules/presentations-live.md`.

### Workspace insights (the analytics overview's data: activity over a date range)
- `backend/docs/wiki/modules/insights.md`

### Themes and brand kits (deck themes, presets, brand kit CRUD, the session theme snapshot)
- `backend/docs/wiki/modules/themes.md`

### Privacy: data export, account deletion and purge, session retention, participant self-removal (W4-C)
- `backend/docs/wiki/modules/privacy.md`
- Add `backend/docs/wiki/modules/sessions.md` only if touching session deletion or the take-home.

### Session history, reports, exports, public results links, participant take-home
- `backend/docs/wiki/modules/sessions.md`
- Add `backend/docs/wiki/modules/presentations-live.md` only if touching what the engine stores per session.

### Audience Q&A, upvotes, moderation, highlight, emoji reactions, the `qna` slide
- `backend/docs/wiki/modules/qna.md` (API, settings, limits, Redis keys, coalescing)
- Add `backend/docs/wiki/realtime/qna.md` only if touching events or the `reaction:send` socket message.

### Realtime Socket/Redis tasks
- `backend/docs/wiki/realtime/envelope.md` (core: registry, auth, envelope, rooms, delivery, the optional cluster adapter)
- `backend/docs/wiki/realtime/presentations.md` or `realtime/polls.md` (the module you touch)
- `backend/docs/wiki/realtime/redis-channels.md`

### Metrics, load test, multi-instance operation
- `backend/docs/wiki/platform/observability.md` (`GET /metrics`, series, answer-storm load test, `loadtest-smoke` CI job)
- `docs/deploy/multi-instance.md` (several backend instances: what is shared, settings, load balancer, scaling numbers)

### HTTP app, middleware order and route mounting tasks
- `backend/docs/wiki/http/app-and-routes.md` (app factory, special mounts, mount table, route snapshot)

### Integration tests, fixtures and dependency spikes
- `backend/docs/wiki/testing/integration.md`
- Add `backend/docs/wiki/http/app-and-routes.md` only if the test touches mounts or middleware.

### AI generation tasks
- `backend/docs/wiki/modules/ai.md` (poll/quiz drafts and whole-deck authoring `POST /api/ai/generate-deck`)
- `backend/docs/wiki/ai/structured-output-contract.md`
- `backend/docs/wiki/ai/prompting-and-graph-flow.md`
- Add `backend/docs/wiki/modules/presentations.md` (registry, `safeParse`, notes) when adding a deck kind.

### Workspaces API, poll tenancy, migration 020
- `backend/docs/wiki/modules/workspaces.md`
- Add `backend/docs/wiki/platform/tenancy.md` only if changing the policy or workspace context.

### Billing: Stripe checkout, portal, webhook, plan catalogue, poll response cap, plan gates
- `backend/docs/wiki/modules/billing.md` (owner's Stripe setup and the list of gates other packages apply)
- Add `backend/docs/wiki/platform/plans.md` only if changing plan numbers, entitlements or usage counters.

### Members, invites, resource sharing, audit log, tenancy isolation test
- `backend/docs/wiki/modules/members-sharing.md`
- Add `backend/docs/wiki/platform/tenancy.md` only if changing the policy, roles or share evaluation.

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
