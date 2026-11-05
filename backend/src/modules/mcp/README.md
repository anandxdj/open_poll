# MCP Integration

Lets any MCP client (Claude, ChatGPT, Cursor, Claude Desktop) act for an Open Poll user: draft
decks with every slide type, run them live with a room, and read the results back, plus the
original async poll and assessment tools. Mounted on the main Express app at `/mcp` (Streamable
HTTP, stateless).

**The contract lives in the wiki: [`backend/docs/wiki/modules/mcp.md`](../../../docs/wiki/modules/mcp.md)**
(request path, context and workspace pinning, scopes, every tool, the slide contract, results and
privacy, resources, prompts, OAuth, tests). This file keeps the file map and the design notes of
the poll tools.

## Two ways to connect

1. **Connector by URL (OAuth 2.1).** Add `<origin>/mcp` as a custom connector in Claude or ChatGPT.
   The client discovers the authorization server from the 401, registers itself, and sends the user
   to `/oauth/consent` on the frontend to pick a workspace and permissions. Tokens rotate; the user
   disconnects the app in Settings → MCP.
2. **Personal access token.** Settings → MCP → Generate token (`opoll_mcp_…`), optionally pinned to a
   workspace; paste the `mcp-remote` config it comes with into a file-configured client.

## Poll tools (v1)

| Tool | Scope | Maps to |
|---|---|---|
| `list_polls` | `poll:read` | `PollService.listPolls` |
| `get_poll` | `poll:read` | `PollService.getPollById` (+`deck:read`) |
| `create_poll` | `poll:create` | `PollService.createPoll` (ungraded polls only) |
| `create_assessment` | `poll:create` | `PollService.createPoll` with `pollType: TRIAL` |
| `edit_poll` | `poll:edit` | `PollService.updatePoll` (+`deck:edit`, blocks closed) |
| `convert_poll_to_assessment` | `poll:edit` | `PollService.updatePoll` → `pollType: TRIAL` |
| `get_poll_analytics` | `analytics:read` | `ResponseService.getPollAnalytics` (aggregate only) |
| `get_share_link` | `poll:read` | `${FRONTEND_URL}/p/:pollId` |

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
separate `presentations` entity, with their own deck, live and results tools.

## Security model

- Tokens (PATs, OAuth access and refresh tokens, client secrets) are stored as **sha256 hashes**;
  raw values are shown or sent once.
- Every tool checks its **scope** (`handleMcpTool`, fails closed on unknown names) and then the
  **workspace policy** of the pinned workspace (`assertCan` / `authorizeDeck`): a scope never widens
  a role.
- Membership is re-checked on every call; removed members and deleted accounts lose access at once.
- No delete tools: deleting decks, polls and sessions stays in the web app. `open_lobby` refuses to
  replace a live session unless `restart: true`.
- Results carry aggregates and the leaderboard top 10 only; audience text is labelled as data.
- Per-token (per-grant) rate limit, 120 requests a minute (Redis, fails open). OAuth endpoints have
  their own per-IP limits.
- Audit: `[McpAudit]` log line per call; `audit()` events for writes (`actorType: 'api'`) and for
  connecting or disconnecting an OAuth app.

## Config

`getMcpPublicUrl(req)` gives the origin used in the PAT connector config and as the OAuth issuer:

1. `API_PUBLIC_URL`, the operator override, needed only when the public origin differs from the one
   users reach the API on.
2. The requesting origin (`x-forwarded-host`/`host` + `x-forwarded-proto`; `trust proxy` is set).
3. `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`.
4. `http://localhost:PORT` in development.

Vercel routes `/mcp`, `/mcp/(.*)`, the two OAuth `/.well-known` documents and
`/oauth/(authorize|token|register|revoke)` to the backend.

## Files

```
mcp.constants.ts          scopes and labels, token prefixes, public URL, connector config
mcp.context.ts            McpUserContext, workspaceScope (pinned workspace), audit helper
mcp.tools.ts              dispatcher: scope check, MCP_TOOL_SCOPES, server instructions
tools/                    tool definitions: context, decks, live, results, polls (+ result views)
mcp.server.ts             McpServer per request: tools from the table, resources, prompts
mcp.resources.ts          openpoll:// resources (read through the tools)
mcp.prompts.ts            run_retro, quiz_from_document, summarize_session
mcp.route.ts              /mcp stateless Streamable HTTP handler
mcp.auth.ts               Bearer PAT or OAuth access token → req.mcp; 401 with resource_metadata
mcp.rateLimit.ts          per-token Redis limiter
mcp.token.model.ts        McpToken (hash, prefix, last4, scopes, workspaceId, expiry)
mcp.token.service.ts      issue / list / revoke / resolve PATs
mcp.schema.ts             zod for token creation and consent approval
mcp.settings.*.ts         /api/mcp/tokens and /api/mcp/grants
oauth/oauth.service.ts    authorization server: clients, consent, codes, tokens, refresh, revoke
oauth/oauth.route.ts      /.well-known metadata and /oauth endpoints (pre-CORS)
oauth/oauth.consent.*.ts  /api/oauth/requests (the consent page's API)
oauth/*.model.ts          OAuthClient, McpGrant
```
Slide contract: `../ai/deck/agent.schema.ts`, `../ai/deck/agentMappers.ts`.
Frontend: `frontend/features/mcp/` (settings section, consent page component, API) and
`frontend/app/oauth/consent/page.tsx`.

## Status

### Done
- [x] PATs, settings, poll tools, scope and owner enforcement, rate limit, audit line
- [x] Schema-enforced assessments and the grading echo (see above)
- [x] Tool table: one definition per tool for schema, scope and handler
- [x] Workspace-pinned context resolved per call; PATs can be pinned
- [x] Stateless transport (multi-instance safe; replaces the in-memory session map)
- [x] Deck tools with every registered slide type; live control; results, Q&A, insights
- [x] Resources and prompts
- [x] OAuth 2.1 with discovery, dynamic registration, PKCE, rotating refresh tokens, consent page,
      connected apps
- [x] Integration tests through the real app for the deck → live → results loop and the OAuth flow

### To do
- [ ] Manual check with Claude.ai and ChatGPT custom connectors against a public https deployment.
- [ ] ChatGPT deep-research `search`/`fetch` tools, if wanted.
- [ ] Token expiry picker for PATs (the model supports `expiresAt`).
- [ ] `close_poll` behind a `poll:close` scope (deferred).
