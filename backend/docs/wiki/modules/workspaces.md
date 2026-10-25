---
summary: Workspaces API (list, create team, read, update, switch default), the team-workspace plan gate, poll tenancy and migration 020.
status: active
last_updated: 2026-10-19
---

# Workspaces Module (`src/modules/workspaces/`)

W0-D landed the models, `ensurePersonalWorkspace` and the tenancy primitives
(`platform/tenancy.md`). W1-B exposes workspaces over HTTP, scopes polls to them and
backfills existing data (migration 020). Members, invites, sharing and the audit log are
W3-B1 (`modules/members-sharing.md`); billing is W3-C.

## Files

| File | Role |
| --- | --- |
| `workspaces.route.ts` | Router mounted at `/api/workspaces` (`src/http/routes.ts`). |
| `workspaces.controller.ts` | HTTP glue: resolves the path workspace, audit events, responses. |
| `workspaces.service.ts` | `WorkspaceService` (`listForUser`, `resolve`, `create`, `update`, `switchDefault`), `toWorkspaceDetail`, the team-workspace plan gate. |
| `workspaces.schema.ts` | Zod bodies for create and update (strict: unknown keys are 400). |
| `provisioning.ts`, `*.model.ts` | W0-D (see `platform/tenancy.md`). |

## API

All routes need `authenticate()`. Routes with `:id` resolve the workspace **from the path**
with `resolveWorkspaceContext(userId, id)` — a live workspace where the caller has an active
membership, otherwise `403 WORKSPACE_FORBIDDEN` (unknown and malformed ids included). They
ignore `X-Workspace-Id`, so a client holding a stale selection can still list and switch.
`tests/integration/tenancy-isolation.test.ts` allow-lists them for that reason (the nested `/:workspaceId/members|invites` routes use `pathWorkspaceContext()` instead).

| Method + path | Body | Authorization | `data` |
| --- | --- | --- | --- |
| `GET /api/workspaces` | – | any user | `{ defaultWorkspaceId, workspaces: WorkspaceSummary[] }` |
| `POST /api/workspaces` | `{ name }` (1–120 chars) | plan gate below; 20/hour/user | `WorkspaceDetail` (201) |
| `GET /api/workspaces/:id` | – | active member | `WorkspaceDetail` |
| `PATCH /api/workspaces/:id` | `{ name?, settings?: { retentionDays?: int ≥ 1 \| null } }` | `workspace:manage` (owner, admin) | `WorkspaceDetail` |
| `POST /api/workspaces/:id/switch` | – | active member | `WorkspaceDetail` |

```ts
WorkspaceSummary = { _id, name, slug, type: 'personal'|'team', plan, role, isDefault }
WorkspaceDetail = {
  workspace: { _id, name, slug, type, plan, ownerId, settings: { retentionDays, requireSso,
               allowedEmailDomains, embedAllowedOrigins, defaultTheme }, createdAt, updatedAt },
  membership: { role, status },
  permissions: Action[],        // what the caller's role allows here (roles.ts)
  entitlements: { plan, features, limits },   // plan ⊕ overrides (platform/plans.md)
}
```

- **List** resolves the default first (`resolveWorkspaceContext(userId)`), so it provisions the
  personal workspace and repairs a stale default, then lists active memberships of live
  workspaces: personal first, then by name. `defaultWorkspaceId` is the effective default.
- **Create** makes a `team` workspace on the `free` plan (`planSource: 'default'`), slug
  `<slugified-name>-<6 hex>` (retried on collision), and the creator's `owner` membership. A
  failed membership write removes the workspace again. It does not switch to it.
- **Update** only takes fields this module owns. `retentionDays` is capped by the plan's
  `retentionDays` (`403 PLAN_LIMIT_REACHED`); `null` means "as long as the plan allows". It is
  stored only; the retention job and its UI land with W4-C. SSO, embed and theme settings are
  added to the schema by the packages that enforce them. Plan, owner and type never change
  here (`400`).
- **Switch** sets `user.defaultWorkspaceId`. The default serves requests without
  `X-Workspace-Id`, MCP tokens, AI generate-and-save, and the next sign-in.
- Detail never includes `billing` or `planOverrides` (entitlements already reflect overrides).
- Audit: `workspace.create`, `workspace.update` (`meta.fields`), against the path workspace.

### Team-workspace plan gate

A team workspace starts on Free, whose single seat only fits its owner; it gains members once
its **own** plan allows more seats (Team, Enterprise, purchased `billing.seats` or a
`limits.seats` override). So a user may own at most `MAX_SINGLE_SEAT_TEAM_WORKSPACES` (1) team
workspaces that are still single-seat; another one needs an existing one upgraded:

```json
403 { "code": "PLAN_LIMIT_REACHED",
      "details": { "limit": "singleSeatTeamWorkspaces", "max": 1, "plan": "free", "workspaceId": "<blocking>" } }
```

Personal workspaces never count. Nothing is charged twice: the plan is bought for the team
workspace itself (W3-C checkout), never inherited. Tune the gate in
`assertCanCreateTeamWorkspace` (`workspaces.service.ts`).

## Poll tenancy

| Route | Middleware | Check |
| --- | --- | --- |
| `POST /api/polls` | `authenticate`, `validate`, `workspaceContext` | `deck:create`; stored with `workspaceId = req.workspace._id` |
| `GET /api/polls` | `authenticate`, `workspaceContext` | `deck:read`; lists the current workspace |
| `GET /api/polls/:id` | optional auth (public) | published: anyone. Draft: `deck:read` in the caller's selected workspace, else 404 |
| `PATCH /api/polls/:pollId` | + `workspaceContext` | `deck:edit` |
| `POST /api/polls/:id/close` | + `workspaceContext` | `deck:host` |
| `POST /api/polls/:id/publish-results` | + `workspaceContext` | `session:share` |
| `DELETE /api/polls/:id` | + `workspaceContext` | `deck:delete` |
| `GET /api/responses/poll/:pollId/list` | + `workspaceContext` | `session:read` |

- Denials are `403 FORBIDDEN` (`assertCan`); a poll in another workspace is denied even to its
  creator, until they select that workspace.
- Unchanged and still public: `GET /api/polls/:id` (published), ballots, guest tokens,
  `POST /api/responses`, `GET /api/responses/poll/:pollId/summary`. On the public read a stale
  `X-Workspace-Id` is ignored, never an error.
- **List fallback for unmigrated polls:** polls without `workspaceId` (created before migration
  020) are listed in their creator's **personal** workspace only, where 020 puts them. The
  policy lets only their creator act on them, from any workspace.
- `PollService.createPoll(payload, creatorId, workspaceId?)`: callers without a request
  workspace (MCP, `POST /api/ai/generate-and-save`) omit it and the poll lands in the creator's
  default workspace, after `deck:create` is checked there.
- `PollService.listPolls({ userId, workspace })` replaces `listPollsByCreator`.
- Index `{workspaceId: 1, createdAt: -1}` (schema + migration 020).

### MCP

Tokens carry no workspace header, so every tool acts in the token owner's **default
workspace** (`resolveWorkspaceContext(userId)`): `list_polls` lists it (with the same
unmigrated-poll fallback), `create_poll`/`create_assessment` create there, and
`get_poll`/`get_share_link` (`deck:read`), `edit_poll`/`convert_poll_to_assessment`
(`deck:edit`) and `get_poll_analytics` (`session:read`) check the policy against it.
Denials keep the MCP message `You do not have permission to access this poll`. Token scopes
are checked first, unchanged; the role check comes on top.

## Migration 020 (`src/migrations/020-workspaces.ts`)

For every user (raw `users` cursor): `ensurePersonalWorkspace` (personal workspace + owner
membership, `defaultWorkspaceId` only when unset), then
`updateMany({creatorId: <id as string or ObjectId>, workspaceId: null}, {$set: {workspaceId}})`
on `polls` and `presentations` with raw collection operations (no schema dependency; the
Presentation schema belongs to W1-A1). Also creates the polls index.

- Idempotent: already scoped documents never move, existing defaults are kept, provisioning is
  upsert-safe. Re-running changes nothing (`tests/integration/migration-020.test.ts`).
- Documents whose `creatorId` matches no user stay unscoped and are counted in the log.
- Presentation indexes (`{workspaceId, updatedAt}`) are W1-A1's.
- Logs: users, personal workspaces created, scoped and unscoped counts per collection.

## Tests

- `tests/workspaces.service.test.ts` — detail/permissions, plan gate, slug retry, update rules,
  schemas (stubbed models).
- `tests/mcp.tools.test.ts` — "workspace scoping" block.
- `tests/integration/workspaces.http.test.ts` — the API end to end.
- `tests/integration/polls.tenancy.test.ts` — cross-user isolation (list, draft read, edit,
  close, publish, delete, responses list), public paths, foreign `X-Workspace-Id` → 403,
  team roles, unmigrated polls, MCP default workspace.
- `tests/integration/migration-020.test.ts` — fixture backfill and idempotency.
