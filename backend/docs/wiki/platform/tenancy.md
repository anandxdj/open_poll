---
summary: Workspaces, roles, the assertCan policy, workspace context middleware, lazy personal-workspace provisioning, and provider identities on User.
status: active
last_updated: 2026-10-19
---

# Tenancy (`common/tenancy/`, `modules/workspaces/`)

Every deck, poll and session belongs to a **workspace**. Users act inside one workspace at a
time, through a **membership** with a **role**. W0-D landed the primitives, W1-B scoped polls and
decks to them (migration 020), W3-B1 made the policy complete: the explicit action matrix,
per-resource shares, members, invites and the audit log (`modules/members-sharing.md`).

## Roles and actions (`common/tenancy/roles.ts`)

`ACTION_MATRIX` is written out row by row (`Y`/`N` per role); `ROLE_PERMISSIONS` is derived from it
and `tests/platform.policy.test.ts` pins every cell independently.

| Action | owner | admin | editor | presenter | viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| `deck:create`, `deck:edit`, `deck:delete`, `deck:share`, `deck:export` | Y | Y | Y | | |
| `deck:read`, `session:read` | Y | Y | Y | Y | Y |
| `deck:host`, `session:export` | Y | Y | Y | Y | |
| `session:share` | Y | Y | Y | | |
| `workspace:manage`, `workspace:members`, `workspace:sso`, `workspace:domains`, `workspace:brand` | Y | Y | | | |
| `workspace:billing` | Y | | | | |

`ROLE_RANK` and `isRoleAtLeast()` order roles for "who may assign which role" checks.

### Shares (`ResourceShare`)

A share gives one user or group a role (`editor`, `presenter` or `viewer`; never `admin`/`owner`,
which are workspace-wide) on one deck or folder. A share on a folder covers the decks in it.

- **Only members.** The policy first requires an active membership of the resource's workspace;
  a share never crosses workspaces and a share for a non-member (even one written by hand) does
  nothing. Suspended members lose their shares' effect with the membership.
- **Raises, never lowers.** A share adds actions on that one resource: `SHARE_PERMISSIONS[role]` =
  the actions the same workspace role has, restricted to `SHAREABLE_ACTIONS` (`deck:read`,
  `deck:edit`, `deck:host`, `deck:export`, `session:read`, `session:export`, `session:share`).
  Creating, deleting and re-sharing decks (`deck:create`, `deck:delete`, `deck:share`) and every
  `workspace:*` action stay with the workspace role. A viewer with an editor share can edit that
  deck, not delete it and not share it on.
- **Never beyond the granter.** Setting shares needs `deck:share` (editor and up), and a share
  role is only accepted when the granter holds all its permissions on the resource themselves,
  so access can be handed down but not up. Recipients cannot re-share (`deck:share` is not
  shareable).
- Personal workspaces have exactly one member (the owner), so there is nobody to share with.

## Policy (`common/tenancy/policy.ts`)

```ts
assertCan(ctx, action, resource?)   // throws 401, or 403 { code: 'FORBIDDEN', details: { action } }
can(ctx, action, resource?)         // boolean
evaluate(ctx, action, resource?)    // { allowed } | { allowed: false, reason }
```

- `ctx` = `{ user: {id}, workspace: {_id}, membership: {role, status, workspaceId}, shareGrants? }`. A
  request after `authenticate()` + `workspaceContext()` satisfies it: `assertCan(req, 'deck:edit', deck)`.
- `resource` = `{ workspaceId?, creatorId?, _id?, folderId?, kind? }` (a deck or poll document works
  as-is; `_id` and `folderId` are only used to match shares, `kind: 'folder'` says `_id` is a folder).
- `assertCan`/`can`/`evaluate` are synchronous and count only the grants in `ctx.shareGrants`.
  Deck code that must honour shares uses the async twins `assertCanWithShares`, `canWithShares`,
  `evaluateWithShares` (they load the caller's grants, directly or through a `WorkspaceGroup`,
  with one extra query and only when the role alone says no). `presentations/access.ts`
  (`authorizeDeck`, `canActOnDeck`) calls them, so every deck route, host action and the socket
  host join honour shares. `evaluate()` reports `via: 'role' | 'share' | 'creator'` when allowed.
- **No `workspaceId`** (data from before migration 020): only `creatorId === user.id` may act,
  for every action, regardless of membership.
- Otherwise: active membership of the current workspace, resource in that same workspace,
  and the role allows the action or a share on the resource (or its folder) does. The denial
  reason is never sent to the client (it would confirm that a resource exists in another
  workspace).

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
- `pathWorkspaceContext(param = 'workspaceId')` is the twin for routes that name the workspace in
  the path (`/api/workspaces/:workspaceId/...`): the path's workspace, 403 `WORKSPACE_FORBIDDEN`
  for non-members, `X-Workspace-Id` ignored.
- Both middlewares carry `WORKSPACE_CONTEXT_MARK`, which `tests/integration/tenancy-isolation.test.ts`
  reads to prove that every `/api` route runs one (see below).

## Isolation guarantees and how they are tested

`tests/integration/tenancy-isolation.test.ts`:

1. **Route table.** It walks the real Express route table; every `/api` route must run one of the
   marked context middlewares, or be on the allow-list in the test with its reason (identity
   and sign-in, public poll voting and participant routes, webhooks, MCP/AI user-level routes,
   invite-token routes, the `/api/workspaces/:id` routes that resolve membership in the
   controller). A route that is neither fails the test, so a new route cannot ship unguarded.
   Stale exact allow-list entries fail too; entries for modules not landed yet are `planned`.
2. **Cross-workspace matrix.** Bob (workspace B) attacks Alice's workspace A over REST — decks,
   polls, host actions, sessions, shares, members, invites, library convert — selecting his own
   workspace, no workspace and A's: every call is 403/404 and nothing in A changes. Lists,
   library and audit never contain the other workspace's data, creation ignores a `workspaceId`
   in the body, uploads and media references stay inside their workspace, and a socket
   `live:join` as host on another workspace's deck is refused (`FORBIDDEN`) however the token
   is presented. Roles inside a workspace and share-based hosting are covered too.

Mounted on `POST /api/uploads/*` (W0-D) and on the authenticated poll routes (W1-B, see
`modules/workspaces.md`, which also covers the workspaces API and migration 020).

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
| `WorkspaceInvite` | `workspaceId, email, role, tokenHash, expiresAt, invitedBy` | `tokenHash` unique; `{workspaceId, email}` unique (migration 100); TTL on `expiresAt` |
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

### Sessions (`modules/auth/auth.service.ts`)

Every sign-in (password, Google, OIDC) ends in `startSession(user)`: an access token and a refresh
token that both carry `authTime` (seconds, the sign-in's time; refreshes copy it), the refresh
token's hash stored on the user. `req.user.authTime` exposes it; `DELETE /api/me` uses it as
re-authentication (`modules/privacy.md`). An account with `deletionRequestedAt` or `deletedAt` set
is not usable (`isAccountUsable`): `authenticate()`, refresh and MCP tokens reject it, and a new
sign-in during the grace period cancels the deletion (`restored`). The same goes for `active: false`
(an account its workspace's SCIM client deactivated, `modules/sso-scim.md`), which also cannot sign in.

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
- Per-workspace SSO (W3-D, `modules/sso-scim.md`) uses `provider: 'saml' | 'oidc_ws'` with
  `connectionId`, through `identityFilter()` / `linkedIdentity()` / `linkIdentity()`.
