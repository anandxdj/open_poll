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
   that user's default workspace (the one last switched to in the app) and
   authorized with the workspace policy on top of the token scopes.

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
| `list_polls` | `poll:read` | `PollService.listPolls` (default workspace) |
| `get_poll` | `poll:read` | `PollService.getPollById` (+`deck:read`) |
| `create_poll` | `poll:create` | `PollService.createPoll` (ungraded polls only) |
| `create_assessment` | `poll:create` | `PollService.createPoll` with `pollType: TRIAL` |
| `edit_poll` | `poll:edit` | `PollService.updatePoll` (+`deck:edit`, blocks closed) |
| `convert_poll_to_assessment` | `poll:edit` | `PollService.updatePoll` → `pollType: TRIAL` |
| `get_poll_analytics` | `analytics:read` | `ResponseService.getPollAnalytics` (aggregate only) |
| `get_share_link` | `poll:read` | `${FRONTEND_URL}/p/:pollId` |

**Excluded by design:** delete, close, publish-results, account/billing/auth.
Deletion and closing stay web-only.

### Create defaults differ from REST

`create_poll` and `create_assessment` fill omitted envelope fields differently from
`POST /api/polls` (`createPollSchema`):

| Field | MCP default | REST default |
|---|---|---|
| `isPublished` | **`true` — live immediately** | `false` (draft) |
| `expiresAt` | 30 days from now | required, no default |
| `isAnonymous` | `true` | `true` |

So an MCP-created poll or assessment is open to anyone with the link the moment the
call returns, unless the agent passes `isPublished: false`. This is deliberate — an
agent asked to "make a poll" should hand back a share link that already works — but it
is easy to miss, so it is stated in three places an agent actually reads: the
`isPublished` field description, both create tools' descriptions, and the server
instructions. `edit_poll` has no defaults; its `isPublished` publishes (`true`) or
unpublishes (`false`).

### Polls vs assessments

The two poll types get **separate tools**, because the tool boundary is the only
place the "graded" contract can actually be enforced:

| `pollType` | UI name | Tool | Behaviour |
|---|---|---|---|
| `POLL` | Poll | `create_poll` | Ungraded opinion poll. The tool's schema has no answer fields at all. |
| `TRIAL` | Assessment / Trial | `create_assessment` | Graded. Every question **must** declare `correctOptionIndices`; also takes `points`, `explanation`, and `passingScorePercentage`. |

#### Why two tools instead of one `pollType` flag

A `.describe()` hint and a server-side `.superRefine` are both invisible to the
thing that decides the payload. An agent validates its tool call against the
emitted **JSON Schema**, so only `required` binds it. With one tool, the schema
said `required: ['text','options']` and an agent could omit the answers and only
learn the rule from a rejection. Splitting the tools puts
`correctOptionIndices` in `required` for the graded one:

```
create_poll        → question required: ['text','options']
create_assessment  → question required: ['text','options','correctOptionIndices']
```

An ungradeable assessment is now unrepresentable rather than merely rejected.
(A top-level `z.discriminatedUnion` on `pollType` would emit a top-level `anyOf`;
MCP/Anthropic `input_schema` must be `type: "object"`, so that route is closed.
JSON Schema `if/then/required` is not expressible in zod and clients enforce it
inconsistently.)

Gradeability rules live in `polls/polls.grading.ts` and are shared with REST.
REST enforces them only for a **published** `TRIAL` (the web builder autosaves
answerless assessment drafts); MCP is stricter and enforces them on every assessment
write, draft or not:

- Every `create_assessment` / `convert_poll_to_assessment` question needs a
  non-empty `correctOptionIndices` (schema-level, so a client catches it pre-flight).
- Indices must be in range for that question's `options`, and a `single`-type question
  accepts at most one (`checkAnswerIndices`, a `.superRefine` on the question shape).
- `edit_poll` on a poll **already stored** as a `TRIAL` rejects answerless questions
  (`assertQuestionsGradeable`). This one cannot live in the input schema — the stored
  `pollType` is only known after the poll is fetched — so it runs in `dispatchMcpTool`
  after the owner check. `PollService.updatePoll` repeats the check for published
  assessments, which covers REST `PATCH` too.

`convert_poll_to_assessment` requires the full replacement `questions` set: the stored
ones were written as an ungraded `POLL` and carry no correct answers. Converting an
assessment back to a plain poll is not exposed; `edit_poll` has no `pollType` field.

#### Verifying the answers are right, not just present

No schema can tell `correctOptionIndices: [1]` from the answer actually being at `0`.
So every graded write returns a `grading` block resolving each index to the stored
option text, plus `gradeable` and `maxScore`:

```json
{ "gradeable": true, "maxScore": 8,
  "questions": [{ "text": "Which planet is closest to the Sun?",
                  "correctAnswers": ["Mercury"], "points": 5 }] }
```

The server instructions tell agents to read it back before reporting success, which
turns a silent off-by-one into something the user sees.

Slide-based decks (`wordcloud`, `ranking`, `scales`, join codes, leaderboards) are the
separate `presentations` entity and are **not** exposed via MCP.

## Security model

- Only the **sha256 hash** of the token is stored (`hashToken`); raw shown once.
- Token carries **scopes**; every tool calls `assertScope` before running.
- Every write re-checks `poll.creatorId === user.id` (`assertPollOwner`).
- **No delete tool, no delete scope** — deletion unreachable via MCP.
- Per-token rate limit (Redis, 120 req/min, fails open).
- Max 5 tokens/user. Optional `expiresAt` (checked on resolve).
- Analytics returns aggregate counts only — no individual voter identities.

## Config

The connector config users copy needs the backend's public origin. `getMcpPublicUrl(req)`
resolves it in this order:

1. `API_PUBLIC_URL` — operator override; only needed when the public origin differs
   from the one users reach the API on.
2. The requesting origin (`x-forwarded-host`/`host` + `x-forwarded-proto`). `app.ts`
   sets `trust proxy`, so this is correct behind Vercel. This is the production path —
   no env var required.
3. `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`, for non-request callers.
4. `http://localhost:PORT` in development.

Vercel routes both `/mcp` and `/mcp/(.*)` to the backend service — `mcp-remote` POSTs
to bare `/mcp`, which the `/mcp/(.*)` pattern alone does not match.

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
- [x] MCP server + 8 tools, scope + owner enforcement, per-token rate limit (Phase 2)
- [x] Wired into `app.ts` (`/mcp`, `/api/mcp`) and settings page
- [x] Backend typecheck clean; MCP frontend lints clean
- [x] `API_PUBLIC_URL` documented in `.env.example`
- [x] Prompt-injection containment: analytics aggregate-only + labeled

### To do
- [x] Connector-config origin derived from the request, so production needs no
      `API_PUBLIC_URL`; `/mcp` and `/mcp/(.*)` both routed in `vercel.json`
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
- [x] **Schema-enforced assessments** — `create_assessment` /
      `convert_poll_to_assessment` put `correctOptionIndices` in the emitted
      JSON Schema `required`, so a client cannot even compose an ungradeable
      assessment; `create_poll` has no answer fields at all.
- [x] **Single source of truth for input shapes** — `mcp.tools.ts` exports the
      zod shapes `mcp.server.ts` registers, so the advertised schema and the
      executed validation cannot drift (the original `pollType` bug).
- [x] **`MCP_TOOL_SCOPES` is live** — `assertToolScope` reads the map and fails
      closed on an unknown tool instead of the map being dead documentation.
- [x] **Grading echo** — every graded write returns `grading` with each correct
      index resolved to its option text, so a wrong-but-valid index is visible.
- [x] **AI path matches** — `AiService` generates a TRIAL against
      `generatedTrialSchema`, which also requires `correctOptionIndices`.
- [x] **REST path matches** — `POST /api/polls` validates with
      `createPollRequestSchema` and `PollService` re-checks on create/update, so a
      published assessment cannot be ungradeable from any surface.
- [x] **Publish-by-default documented** — field/tool descriptions, server
      instructions, and "Create defaults differ from REST" above.
- [ ] **v2 tools** (deferred): `close_poll` behind a `poll:close` scope.
- [ ] Rename `prefix`/`last4` display if you want a nicer masked format in the UI.
