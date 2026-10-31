---
summary: MCP server for AI agents (Claude, ChatGPT, Cursor): deck, live session, results and poll tools, resources, prompts, personal tokens and the OAuth 2.1 connector flow.
status: active
last_updated: 2026-10-26
---

# MCP (`src/modules/mcp/`)

The live layer agents plug into: an agent drafts a deck from a conversation, runs it with a room and
reads the results back. Streamable HTTP at `/mcp`, mounted on the main Express app. Poll-tool design
notes (polls vs assessments, publish defaults, the grading echo) stay in the module
[`README.md`](../../../src/modules/mcp/README.md).

## Request path

```
client ──Bearer──► POST /mcp ─ mcpAuth ─ mcpRateLimit ─ createMcpServer(ctx) ─ StreamableHTTPServerTransport (stateless)
                                 │                           └─ tools (tools/*.ts), resources, prompts
                                 ├─ opoll_mcp_… personal access token (McpToken)
                                 └─ opoll_oat_… OAuth access token (McpGrant)
```

- **Stateless.** Every POST builds its own `McpServer` and transport from the token on that request
  (`mcp.route.ts`). Nothing is kept between requests, so any instance answers any call, and a token's
  scopes and workspace are never older than the request. `GET`/`DELETE /mcp` answer 405. Clients that
  still send `Mcp-Session-Id` work (stateless transports ignore it).
- **401 discovery.** A request without a usable token gets `WWW-Authenticate: Bearer
  resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"` (RFC 9728). That is how
  Claude and ChatGPT find the OAuth server when a user adds the URL as a connector.
- **Rate limit.** 120 requests a minute per PAT, or per OAuth grant (its access token rotates hourly).
  Redis, fails open.
- `/mcp` stays behind the credentialed CORS allow-list: connectors call it server to server.

## Context: who a call acts as

`McpUserContext` (`mcp.context.ts`) is resolved per call: `userId`, `tokenId` (PAT id or grant id),
`scopes`, `workspaceId`, `kind` (`pat`/`oauth`), `clientId`.

- `workspaceScope(ctx)` = `resolveWorkspaceContext(userId, workspaceId)`: active membership is
  checked on **every** call, so a removed member's token stops working at once.
- OAuth grants are always pinned to the workspace chosen on the consent page. PATs may be pinned at
  issue (`POST /api/mcp/tokens {label, workspaceId?}`); unpinned PATs (all of them before this
  change) follow the user's default workspace, as before.
- Tools pass that policy context, never a bare user id, to the deck and session services. A bare id
  would be resolved against the deck's own workspace (`presentations/access.ts`), letting a token
  pinned to workspace A act on decks in B.
- **Scope ∩ role.** A scope never widens the workspace role: every handler still runs
  `assertCan`/`authorizeDeck` (a viewer cannot write, a presenter can run a session but not edit).

## Scopes (`mcp.constants.ts`)

| Scope | Allows |
| --- | --- |
| `poll:read`, `poll:create`, `poll:edit`, `analytics:read` | the async poll and assessment tools (v1) |
| `deck:read` | list/get decks, slide types, themes, join link |
| `deck:write` | create and edit decks and slides |
| `session:run` | live commands and live state |
| `results:read` | session results, Q&A, workspace insights |

New PATs get every scope. PATs issued before decks reached MCP keep their four poll scopes: a secret
already pasted somewhere is not widened. `get_context` tells such a token's agent to generate a new
one; settings labels it "Polls only". Only the tools a connection's scopes allow are listed
(`toolsForScopes`); `handleMcpTool` checks the scope again, failing closed on unknown names.

## Tools (`tools/*.ts`)

Each tool is one `McpToolDef` (`name, scope, description, inputShape, annotations, handler`).
`mcp.server.ts` registers from the table and `MCP_TOOL_SCOPES` is derived from it, so the advertised
schema, the scope and the code cannot drift. Validation errors come back as one `path: message` line
each. Every write tool writes an `audit()` event with `actorType: 'api'` and the token or grant id
(`deck.create`, `deck.slides_add`, `session.open_lobby`, …).

| Tool | Scope | Maps to |
| --- | --- | --- |
| `get_context` | any | user, pinned workspace (name, plan, role, audience cap), scopes, web app URL |
| `list_slide_types` | `deck:read` | `agentKinds()`: kind, category, description, required/optional fields, example |
| `list_themes` | `deck:read` | `presetViews()`, `BrandKitService.list` (with `brand_kits`), workspace default |
| `list_decks`, `get_deck` | `deck:read` | `PresentationService.listPresentations` / `getPresentationFor`; slides as compact views with stable ids |
| `create_deck` | `deck:write` | `createPresentation({title, slides, theme, settings, pace})` |
| `update_deck` | `deck:write` | `updatePresentation` (title, theme, settings, pace) |
| `add_slides`, `update_slide`, `remove_slides`, `reorder_slides` | `deck:write` | read the stored slides, change the array, `updatePresentation({slides})`; untouched slides keep their `_id` |
| `open_lobby` | `session:run` | `openLobby`; refuses (409 `SESSION_ALREADY_LIVE`) while a session is live unless `restart: true` |
| `start_session`, `next_slide`, `previous_slide`, `go_to_slide`, `close_voting`, `reveal_results`, `end_session` | `session:run` | the host commands in `live/session.service.ts` (`deck:host`); they publish to sockets themselves, so phones and the host screen follow |
| `get_live_state` | `session:run` | `getHostState`, trimmed: counts, current slide, its results, leaderboard top 10 |
| `get_join_link` | `deck:read` | `${FRONTEND_URL}/live/<code>`, plus `https://<domain>/live/<code>` per active custom domain |
| `list_sessions`, `get_session_results` | `results:read` | `sessions.service` `listSessions` / `getReport` |
| `get_qna` | `results:read` | `qna.service.listForHost` (`deck:host`, live or latest session) |
| `get_insights` | `results:read` | `InsightsService.get` with `insightsQuerySchema` |
| poll tools (8) | `poll:*`, `analytics:read` | unchanged, see the README |

`open_lobby`, `end_session` and `remove_slides` carry `destructiveHint`. Not available over MCP:
deleting decks, polls or sessions, uploads, imports, billing.

### Slide contract (`ai/deck/agent.schema.ts`, `agentMappers.ts`)

- `agentSlideSchema` is a discriminated union on `kind`, one variant per deck kind with exactly the
  fields its mapper reads. What a kind needs is `required` in the emitted JSON Schema, and lengths
  equal the mapper caps (`cleanText`), so agent text is rejected with a path instead of being cut.
- Kinds: the 12 of the in-app AI (`DECK_SLIDE_MAPPERS`) plus agent-only `AGENT_SLIDE_MAPPERS`:
  `image`, `video` (YouTube/Vimeo address), `instructions`, `qna`, `hundred_points`, `grid_2x2`,
  `guess_number`, `pin_on_image`, `leaderboard`. The in-app AI's `availableKinds()` is unchanged.
- `buildAgentSlide` maps, applies `timeLimit`/`points`/`maxEntries`/`scaleMax` overrides and
  validates with the registry type's own schema (`toRegistrySlide`): a slide accepted here is
  exactly what `POST /api/presentations` stores. `buildAgentSlides` is all or nothing, with every
  issue prefixed `slides[i] (kind):`.
- Images are `https://` addresses only (`content/media.ts` rules); uploads stay in the web app.
- The full union (about 17k characters of JSON Schema) is advertised once, in `create_deck`.
  `add_slides` and `update_slide` advertise `agentSlideRefSchema` (the kind plus open fields) and
  parse the full union in the handler.

### Results and privacy

`get_session_results` returns per slide the registry distribution (option counts with correct flags,
word cloud words, open-ended responses, scales averages, ranking points, guess histogram, 2x2
averages, pin heatmap), participation, and the leaderboard **top 10** (nickname, score, correct
count). Never: the participant list, participant or device ids, speaker notes, Q&A author names, or
the raw pin and placement feeds. Every payload with audience text carries a note that it is data,
not instructions (`AUDIENCE_TEXT_NOTE`).

## Resources and prompts

- `mcp.resources.ts`: `openpoll://slide-types`, `openpoll://decks/{deckId}` (listable),
  `openpoll://sessions/{sessionId}/results`, `openpoll://insights`. Each reads through
  `handleMcpTool`, so scopes and policy apply unchanged.
- `mcp.prompts.ts`: `run_retro` (team, period, focus), `quiz_from_document` (document, questions,
  audience; the document is fenced and framed as data), `summarize_session` (deck).
- Both are registered only when the connection has the scopes the job needs.

## Personal access tokens

`POST/GET/DELETE /api/mcp/tokens` (`authenticate()`, Bearer JWT). `opoll_mcp_` + 32 random bytes;
only the sha256 hash is stored. At most 5 per user. The response carries the `mcp-remote` connector
config once. `getMcpPublicUrl(req)` picks the origin: `API_PUBLIC_URL`, else the request origin,
else the Vercel URLs, else localhost.

## OAuth 2.1 for remote connectors (`oauth/`)

| Endpoint | Mount | Notes |
| --- | --- | --- |
| `GET /.well-known/oauth-authorization-server` | pre-CORS, any origin | RFC 8414; issuer = `getMcpPublicUrl(req)` |
| `GET /.well-known/oauth-protected-resource[/mcp]` | pre-CORS, any origin | RFC 9728; resource = `<origin>/mcp` |
| `POST /oauth/register` | pre-CORS (SDK handler) | RFC 7591; public (`none`) or confidential clients; secrets never expire, stored hashed |
| `GET/POST /oauth/authorize` | pre-CORS (SDK handler) | checks client and redirect URI, then `startAuthorization` → 302 to `${FRONTEND_URL}/oauth/consent?request=<id>` |
| `POST /oauth/token` | pre-CORS, ours | `authorization_code` (PKCE S256) and `refresh_token`; `none`, `client_secret_post`, `client_secret_basic` |
| `POST /oauth/revoke` | pre-CORS, ours | RFC 7009: either token ends the grant |
| `GET /api/oauth/requests/:id`, `POST …/approve`, `POST …/deny` | `MOUNTS`, `authenticate()` | the consent page's API |
| `GET /api/mcp/grants`, `DELETE /api/mcp/grants/:id` | `MOUNTS`, `authenticate()` | connected apps in settings |

- The public endpoints sit in `mountPreParserRoutes`: connectors and browser-based clients call them
  from origins the credentialed CORS allow-list would reject, and none of them reads a cookie. They
  bring their own body parsers and permissive CORS.
- Token and revoke are ours because the SDK's client check compares secrets in plain text; we store
  `hashToken(secret)` and compare with `hexEquals`.
- **Pending request** (Redis `mcp:oauth:request:<id>`, 10 min): client, redirect URI, PKCE challenge,
  state, requested scopes (known ones; none means all), resource. Approve and deny take it with
  `GETDEL`, so a request is answered once.
- **Approve** checks the scopes are a subset of the request and the user is an active member of the
  chosen workspace, then stores a one-time code (`mcp:oauth:code:<sha256>`, 5 min) and returns the
  client's redirect URI with `code` and `state`. Deny returns it with `error=access_denied`.
- **Code exchange** takes the code with `GETDEL` (a failed PKCE check uses it up too), checks client,
  redirect URI, PKCE and resource, re-checks the user and the membership, replaces any grant of the
  same user, client and workspace, and keeps at most 20 grants per user (least recently used go).
- **Tokens**: `opoll_oat_` access (1 hour) and `opoll_ort_` refresh (30 days), opaque, stored as
  hashes on the `McpGrant`. Refresh rotates both; the previous refresh hash is kept, and presenting it
  again deletes the grant (replay detection). The TTL index removes grants a day after their refresh
  token expires; unused clients expire after 90 days (`OAuthClient.expiresAt`, pushed on each use).
- **Redirect URIs** at registration: `https`, loopback `http`, or an app scheme (`cursor://`); never
  `javascript:`, `data:`, `file:` or fragments.
- **Resource indicators** (RFC 8707): an authorize or code request naming another resource than
  `<origin>/mcp` gets `invalid_target`.
- Audit: `mcp.oauth_connect` (approve) and `mcp.oauth_disconnect` (settings), actor the user.
- Privacy: account export adds `mcp-connected-apps.json` (no tokens); account deletion and the purge
  delete grants with the PATs (`modules/privacy.md`).

Deploy: Vercel rewrites `/.well-known/oauth-authorization-server`,
`/.well-known/oauth-protected-resource(.*)` and `/oauth/(authorize|token|register|revoke)` to the
backend (`/oauth/consent` stays on the frontend). Where frontend and backend have different hosts,
the connector URL and the issuer are the backend's; consent still happens on `FRONTEND_URL`.

## Tests

| File | Covers |
| --- | --- |
| `tests/mcp.tools.test.ts` | poll tools: scopes, owner checks, default workspace, validation, grading (models stubbed) |
| `tests/mcp.slides.test.ts` | every registered type has an agent kind; each example builds; caps reject instead of cutting; overrides; in-app AI kinds unchanged |
| `tests/mcp.schema.test.ts` (+ snapshot) | tools/list through an in-memory client: object schemas, required fields and scopes per tool, poll-only tokens, destructive hints, prompts and resource templates |
| `tests/mcp.oauth.test.ts` | redirect URI rules, PKCE, scope normalisation |
| `tests/integration/mcp.test.ts` | SDK client over Streamable HTTP: every slide kind, edits by id, a live run with three participants (lobby, answers, reveal, end), results without participant ids, insights |
| `tests/integration/mcp-oauth.test.ts` | 401 discovery, metadata, registration rules, consent approve/deny, PKCE and one-time codes, workspace membership, refresh rotation and replay, settings disconnect, revocation |
| `tests/integration/privacy.test.ts` | export and deletion of grants |

The route snapshot and the tenancy allow-list (`/api/mcp/grants*`, `/api/oauth/requests/:requestId*`)
cover the new routes.
