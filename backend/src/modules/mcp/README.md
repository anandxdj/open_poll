# MCP Integration

Lets any MCP client (Claude, etc.) act as a logged-in Open Poll user via a
per-user Personal Access Token (PAT). Same-service — mounted on the existing
Express app. No cookies/JWT for the MCP surface; PAT only.

## How it works

1. User opens **Settings → MCP**, generates a token (`opoll_mcp_...`).
2. UI shows a copyable **connector config** (token embedded) **once**.
3. User pastes config into their MCP client.
4. Client calls `POST /mcp` with `Authorization: Bearer opoll_mcp_...`.
5. Server resolves token → user, exposes scoped tools, every query scoped to
   that user's `creatorId`.

```
MCP client ──Bearer opoll_mcp_xxx──► POST /mcp
   └─ mcpAuth (PAT→user) ─ mcpRateLimit (per-token) ─ McpServer ─► PollService / ResponseService
```

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `POST/GET/DELETE /mcp` | PAT (Bearer) | MCP Streamable HTTP transport |
| `POST /api/mcp/tokens` | cookie/JWT | Issue token (returns raw token + config, once) |
| `GET /api/mcp/tokens` | cookie/JWT | List active tokens (metadata only, no secret) |
| `DELETE /api/mcp/tokens/:tokenId` | cookie/JWT | Revoke token |

## Tools (v1)

| Tool | Scope | Maps to |
|---|---|---|
| `list_polls` | `poll:read` | `PollService.listPollsByCreator` |
| `get_poll` | `poll:read` | `PollService.getPollById` (+owner check) |
| `create_poll` | `poll:create` | `PollService.createPoll` |
| `edit_poll` | `poll:edit` | `PollService.updatePoll` (+owner, blocks closed) |
| `get_poll_analytics` | `analytics:read` | `ResponseService.getPollAnalytics` (aggregate only) |
| `get_share_link` | `poll:read` | `${FRONTEND_URL}/p/:pollId` |

**Excluded by design:** delete, close, publish-results, account/billing/auth.
Deletion and closing stay web-only.

## Security model

- Only the **sha256 hash** of the token is stored (`hashToken`); raw shown once.
- Token carries **scopes**; every tool calls `assertScope` before running.
- Every write re-checks `poll.creatorId === user.id` (`assertPollOwner`).
- **No delete tool, no delete scope** — deletion unreachable via MCP.
- Per-token rate limit (Redis, 120 req/min, fails open).
- Max 5 tokens/user. Optional `expiresAt` (checked on resolve).
- Analytics returns aggregate counts only — no individual voter identities.

## Config

`API_PUBLIC_URL` — public origin of THIS backend, used to build the connector
config users copy. **MUST be set in production** (e.g.
`https://openpoll-backend.anands.dev`); otherwise config points at
`http://localhost:PORT`. See `.env.example`.

## Files

```
mcp.constants.ts          scopes, tool→scope map, connector config builder
mcp.token.model.ts        McpToken schema (hash, prefix, last4, scopes, expiry)
mcp.token.service.ts      issue / list / revoke / resolve
mcp.schema.ts             zod for token creation
mcp.settings.controller.ts + mcp.settings.route.ts   /api/mcp/tokens
mcp.auth.ts               Bearer PAT → req.mcp
mcp.rateLimit.ts          per-token Redis limiter
mcp.tools.ts              tool logic + scope/owner enforcement
mcp.server.ts             McpServer + tool registration (zod input schemas)
mcp.route.ts              /mcp Streamable HTTP handler
```
Frontend: `frontend/features/mcp/` (`api/mcp.api.ts`, `components/McpSettingsSection.tsx`),
mounted in `app/(dashboard)/settings/page.tsx`.

## Status

### Done
- [x] Token model, service, settings endpoints (Phase 1 backend)
- [x] Settings → MCP tab: generate / copy config / list / revoke (Phase 1 frontend)
- [x] MCP server + 6 tools, scope + owner enforcement, per-token rate limit (Phase 2)
- [x] Wired into `app.ts` (`/mcp`, `/api/mcp`) and settings page
- [x] Backend typecheck clean; MCP frontend lints clean
- [x] `API_PUBLIC_URL` documented in `.env.example`
- [x] Prompt-injection containment: analytics aggregate-only + labeled

### To do
- [ ] **Set `API_PUBLIC_URL` in production env** (else copied config points to localhost).
- [ ] **Manual end-to-end test with a real MCP client** (Claude Desktop via
      `mcp-remote`): connect, list/create/edit poll, read analytics, get share link.
- [ ] **Token expiry UX** — model supports `expiresAt`, but issue flow always
      sets none and UI has no expiry picker. Add if desired.
- [ ] **`lastUsedAt` display** already wired in UI; confirm it updates (fire-and-forget
      write in `resolveToken`).
- [ ] **Stateful transport cleanup** — `mcp.route.ts` keeps sessions in an
      in-memory `Map` keyed by session id, now idle-evicted after 30 min. Fine for
      single instance; for multi-instance deploys either use sticky sessions or
      move to stateless mode.
- [x] **Audit log** — `[McpAudit]` line per tool call (tool, tokenId, userId, ok/error).
- [x] **Session ownership check** — sessions are bound to the userId that created
      them; a request bearing another user's token for the same session id is
      rejected (403) instead of silently executing as the original user.
- [x] **Poll schema reuse** — `create_poll`/`edit_poll` validate through the same
      `createPollSchema`/`updatePollSchema` as the REST API instead of a hand-rolled
      duplicate, so defaults/constraints can't silently drift.
- [x] **pollId validation** — malformed ids rejected as `400` before hitting Mongoose.
- [ ] **Revoke-all / rotate** convenience action (optional).
- [ ] **v2 tools** (deferred): `close_poll` behind a `poll:close` scope.
- [ ] Rename `prefix`/`last4` display if you want a nicer masked format in the UI.
