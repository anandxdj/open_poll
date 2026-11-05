---
summary: Concise architecture and implementation decisions by phase.
status: active
last_updated: 2026-10-26
---

# Decision Log

## 2026-10-26 (MCP for agents: decks, live, results, OAuth)
- MCP is the live layer agents plug into: deck, live-control and results tools next to the poll tools. Tools are one table (`tools/*.ts`) that both registers and dispatches, so schema, scope and code cannot drift; only the tools a connection's scopes allow are listed.
- The `/mcp` transport is stateless: a server per request, built from the bearer token. It drops the in-memory session map (multi-instance safe) and means a rotated OAuth token or a narrowed scope applies at once.
- Every MCP call acts in one pinned workspace (`resolveWorkspaceContext(userId, workspaceId)` per call) and passes that policy context, never a bare user id, to deck and session services. A scope never widens the workspace role.
- Old PATs keep their poll-only scopes; new ones get every scope. A pasted secret is not silently widened.
- Agents author slides against a discriminated union per deck kind that reuses the AI deck mappers (plus agent-only mappers for the kinds the in-app AI does not write) and the registry `safeParse`; lengths equal the mapper caps so text is rejected, not cut. The full union is advertised once, in `create_deck`.
- Results reach agents as registry aggregates plus the leaderboard top 10; no participant list or ids, no Q&A authors; audience text is labelled as data.
- The OAuth 2.1 authorization server lives in the backend on the SDK's authorize and registration handlers, with our own token and revocation endpoints (client secrets stored hashed), consent on the frontend, opaque hashed tokens, rotating refresh tokens with replay detection, and grants pinned to a workspace. Public OAuth endpoints are mounted before the credentialed CORS allow-list.

## 2026-10-19 (W0-D platform primitives)
- Workspaces with roles `owner|admin|editor|presenter|viewer`; one action matrix in `common/tenancy/roles.ts`, enforced by `assertCan`. Billing is owner-only. Resources without `workspaceId` fall back to `creatorId` until migration 020.
- The personal workspace is provisioned lazily by `workspaceContext()` (partial unique index `{ownerId, type:'personal'}`), so auth flows stay workspace-agnostic.
- Plans are enforced with or without Stripe; numbers live only in `common/plans/plans.ts`. Monthly quotas count in Redis and mirror to Mongo (`UsageCounter`), falling back to Mongo while Redis is down.
- Capabilities (deployment config) are separate from entitlements (workspace plan); both are explicit so the UI can explain why something is unavailable.
- Storage is one S3-compatible bucket via `Bun.S3Client`; browsers upload to presigned PUTs and `complete` verifies type and size with a HEAD, because presigned PUTs cannot enforce them. No SVG uploads.
- Provider links moved from the shared `user.sub` to `identities[]` (Google and OIDC overwrote each other); legacy `sub` is read once for OIDC and backfilled.
- New collections use `autoIndex: !isProduction`; production indexes come from numbered migrations (`bun run migrate`, Mongo lock document). Existing collections keep autoIndex until a migration takes them over.
- `ApiError` gained an optional machine-readable `code` and `details`.

## 2026-10-18 (quizzes → presentations, gradeable assessments)
- Deleted the unmounted `quizzes` backend module; `presentations` is the only live-deck module. The `quiz:*` socket names, `quiz_{id}` rooms and the `/api/quizzes` alias stay as wire compatibility.
- Folded `frontend/features/quizzes` into `features/presentations`; `/quiz/*` and `/quizzes` 308-redirect to the presentation routes, and the host QR code points at `/live/{code}`.
- A **published** `TRIAL` poll must be gradeable on every surface (`polls/polls.grading.ts`): REST create validates with `createPollRequestSchema`, `PollService` re-checks on create/update against the stored poll. Drafts may be answerless because the web builder autosaves them; MCP stays stricter and always requires answers.

## 2026-06-10 (live quiz feature)
- New `quizzes` module: Quiz doc holds both slide deck and live session state; presenter-paced state machine.
- Scoring is server-clock only; Kahoot-style decay `points * (1 - ratio/2)` with per-slide toggle.
- Answer hot path runs entirely on Redis (session cache, SADD dedup, ZSET scores) with Mongo as async write-behind — verified ~1100 answers/sec single instance.
- Participants authenticate answers with a join-time secret token; participantId alone is public.
- Added Redis fixed-window per-IP rate limiter (fails open); applied to quiz public routes + auth routes.
- Quiz realtime uses one envelope event `quiz:event` on room `quiz_{quizId}` via Redis pub/sub (same bridge pattern as analytics).
- `open-lobby` wipes the previous run (participants/answers/Redis keys); session history deferred to roadmap Phase 7.
- Roadmap for remaining Mentimeter parity lives in `quiz-roadmap.md` (Phases 3–8).

## 2026-05-11
- Adopted room key = `pollId` for creator live analytics subscriptions.
- Chose Redis pub/sub bridge (`responses.accepted`) as source for socket fanout events.
- Kept auth deferred and standardized mocked creator id behavior in controllers.
- Used LangChain structured output + LangGraph node flow for AI draft generation.
- Added always-on Cursor context-router rule to enforce minimal wiki doc loading per task.
- Added `beforeSubmitPrompt` hook to auto-append per-chat prompt log entries in `chat-log.md`.
