---
summary: Workspaces, roles, the assertCan policy, workspace context middleware, lazy personal-workspace provisioning, and provider identities on User.
status: active
last_updated: 2026-10-19
---

# Tenancy (`common/tenancy/`, `modules/workspaces/`)

Every deck, poll and session will belong to a **workspace**. Users act inside one workspace at
a time, through a **membership** with a **role**. W0-D lands the primitives only: nothing
existing is scoped yet. W1-B mounts the middleware on existing routes and backfills
`workspaceId` (migration 020); W3-B1 adds per-resource shares to the policy.

## Roles and actions (`common/tenancy/roles.ts`)

| Role | Allowed actions |
| --- | --- |
| `owner` | everything |
| `admin` | everything except `workspace:billing` |
| `editor` | `deck:{create,read,edit,delete,host,share,export}`, `session:{read,export,share}` |
| `presenter` | `deck:read`, `deck:host`, `session:read`, `session:export` |
| `viewer` | `deck:read`, `session:read` |

Workspace actions: `workspace:{manage,billing,members,sso,domains,brand}`. `ROLE_RANK` and
`isRoleAtLeast()` order roles for "who may assign which role" checks.

## Policy (`common/tenancy/policy.ts`)

```ts
assertCan(ctx, action, resource?)   // throws 401, or 403 { code: 'FORBIDDEN', details: { action } }
can(ctx, action, resource?)         // boolean
evaluate(ctx, action, resource?)    // { allowed } | { allowed: false, reason }
```

- `ctx` = `{ user: {id}, workspace: {_id}, membership: {role, status, workspaceId} }`. A request
  after `authenticate()` + `workspaceContext()` satisfies it: `assertCan(req, 'deck:edit', deck)`.
- `resource` = `{ workspaceId?, creatorId? }` (a deck or poll document works as-is).
- **No `workspaceId`** (data from before migration 020): only `creatorId === user.id` may act,
  for every action, regardless of membership.
- Otherwise: active membership of the current workspace, resource in that same workspace,
  role allows the action. The denial reason is never sent to the client (it would confirm
  that a resource exists in another workspace).

## Workspace context (`common/tenancy/workspaceContext.middleware.ts`)

```ts
router.get('/x', authenticate(), workspaceContext(), handler)  // sets req.workspace, req.membership
resolveWorkspaceContext(userId, requestedId?)                   // same logic without Express (sockets, MCP)
```

- `X-Workspace-Id` header: must name a live (not deleted) workspace where the user has an
  **active** membership, else 403 `WORKSPACE_FORBIDDEN` (malformed ids included).
- No header: the user's `defaultWorkspaceId`; if missing or no longer usable, the personal
  workspace, provisioned on first use. A stale default is repointed to it. Sign-up and
  sign-in flows therefore need no workspace code.
- Type requests as `WorkspaceRequest` (extends `AuthRequest`).

Not mounted on any existing route in W0-D. `POST /api/uploads/*` is the only user so far.

## Provisioning (`modules/workspaces/provisioning.ts`)

`ensurePersonalWorkspace(user)` returns `{workspace, membership}`, creating the personal
workspace (`"<name>'s workspace"`, slug `<slugified-name>-<6 hex>`, plan `free`) and the owner
membership if missing, and sets `defaultWorkspaceId` when the user has none (conditional
update, never overrides a switch). Concurrency-safe through the partial unique index
`{ownerId, type}` where `type: 'personal'`: losers of the insert race re-read the winner.
`ensureMembership(workspaceId, userId, role, source)` is the idempotent membership upsert;
`generateWorkspaceSlug(name)` makes slugs for team workspaces (retry on E11000).

## Models

| Model (collection) | Fields | Indexes |
| --- | --- | --- |
| `Workspace` (`workspaces`) | `name, slug, type: personal\|team, ownerId, plan, planSource: default\|stripe\|manual, planOverrides, billing{stripeCustomerId, stripeSubscriptionId, status, priceId, seats, currentPeriodEnd, cancelAtPeriodEnd}, settings{retentionDays, requireSso, allowedEmailDomains[], embedAllowedOrigins[], defaultTheme}, deletedAt` | `slug` unique; `{ownerId, type}` unique partial `type:'personal'` (`personal_workspace_per_owner`); `ownerId`; `billing.stripeCustomerId` unique partial (string) |
| `WorkspaceMember` | `workspaceId, userId, role, status: active\|invited\|suspended, source: manual\|scim\|sso_jit` | `{workspaceId, userId}` unique; `userId` |
| `WorkspaceInvite` | `workspaceId, email, role, tokenHash, expiresAt` | `tokenHash` unique; `{workspaceId, email}`; TTL on `expiresAt` |
| `WorkspaceGroup` | `workspaceId, displayName, externalId, memberIds[]` | `{workspaceId, displayName}`, `{workspaceId, externalId}`, `memberIds` |
| `ResourceShare` | `workspaceId, resourceType: presentation\|folder, resourceId, principalType: user\|group, principalId, role: editor\|presenter\|viewer` | `{resourceType, resourceId, principalType, principalId}` unique; `{workspaceId, principalType, principalId}` |
| `UsageCounter` | see `platform/plans.md` | |

All new schemas use `autoIndex: !isProduction`; production indexes come from migrations
(`platform/migrations.md`).

## User fields (`modules/auth/auth.model.ts`)

`defaultWorkspaceId`, `locale`, `active` (default true; SCIM deprovisioning),
`identities[{provider: google|oidc|saml|oidc_ws, connectionId, subject}]` (index
`{identities.provider, identities.subject}`), `scim{externalId, workspaceId}`,
`deletionRequestedAt`, `deletedAt`. `sub` is kept but no longer written.

### Provider identities (`modules/auth/identities.ts`)

Google and OIDC used to both write `user.sub`, so a Google sign-in made a later OIDC sign-in
fail with 409. Each provider now has its own `identities[]` entry:

- **OIDC** (`OidcService.findOrLinkUser`): by `oidc` identity → by legacy `sub` (accounts
  linked before identities existed; the identity is backfilled on that login) → by verified
  email → new user. 409 only if the account already has a *different* `oidc` subject; the
  legacy `sub` is never used for conflicts (it may hold a Google subject).
- **Google** (`AuthService.findOrLinkGoogleUser`): by `google` identity → by verified email →
  new user. A different Google subject proving the same email replaces the Google link (as
  email matching always allowed).
- Both keep the pre-hijack rule: linking an unverified local account wipes its password,
  pending tokens, sessions and role first (`resetUnverifiedAccount`).
- Per-workspace SSO (W3-D) uses `provider: 'saml' | 'oidc_ws'` with `connectionId`, through
  `identityFilter()` / `linkedIdentity()` / `linkIdentity()`.
