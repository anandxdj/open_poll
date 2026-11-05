---
summary: Workspace members, invitations, resource shares (ResourceShare), the audit log API, seat limits, the last-owner guard, migration 100 and the tests.
status: active
last_updated: 2026-10-19
---

# Members, invites, sharing and audit (W3-B1)

Files in `src/modules/workspaces/` unless noted. The role matrix, share semantics and isolation
guarantees live in `platform/tenancy.md`; the workspaces API itself in `modules/workspaces.md`.

| File | Role |
| --- | --- |
| `members.route.ts`, `members.controller.ts`, `members.service.ts` | `/api/workspaces/:workspaceId/members`; `MembersService` (list, update, remove, transfer), `memberChangeDenial()`, seat counts. Also holds `actorOf()` / `parseQuery()` used by the other controllers. |
| `invites.route.ts`, `invites.service.ts` | `/api/workspaces/:workspaceId/invites` (admin side) and `/api/invites` (invitee side, `invitesRouter`). |
| `sharing.route.ts`, `sharing.controller.ts`, `sharing.service.ts` | `/api/shares`. |
| `members.schema.ts` | Zod bodies and queries (strict: unknown keys are 400). |
| `modules/audit/audit.route.ts`, `audit.service.ts` | `GET /api/audit`. |
| `src/migrations/100-workspace-invites.ts` | One pending invite per workspace and address. |
| `common/config/email.ts` | `sendWorkspaceInviteEmail` (Resend; logged when `RESEND_API_KEY` is empty). Every email uses `emailLayout` (`common/config/emailLayout.ts`): the logo, a white sheet on paper, one ember button and the link spelled out under it. |

## Members

Mounted with `pathWorkspaceContext()`: the workspace in the URL, caller an active member, else
`403 WORKSPACE_FORBIDDEN`. `X-Workspace-Id` is ignored.

| Method + path | Body | Authorization | Result |
| --- | --- | --- | --- |
| `GET /members` | – | any active member | `{ members: MemberView[], seats: {used, pending, limit}, canManage }` |
| `PATCH /members/:userId` | `{ role?, status? }` (`status`: `active`\|`suspended`) | `workspace:members` + rank rules | `{ member }` |
| `DELETE /members/:userId` | – | `workspace:members` + rank rules, or the member themself (leave) | 200 |
| `POST /members/:userId/transfer-ownership` | – | the primary owner only | `{ member }` |

```ts
MemberView = { userId, name, email, picture, role, status, source, joinedAt, isPrimaryOwner }
```

- **Who sees the list.** Every active member (name, email, role): the ShareDialog needs it, and a
  team knows its own roster. Role changes need `workspace:members` (owner, admin).
- **Rank rules** (`memberChangeDenial`): you change or remove members up to your own rank, assign
  roles up to your own rank, and only owners touch the owner role (`403 ROLE_NOT_ASSIGNABLE`).
- **Owners.** `workspace.ownerId` is the *primary owner* (billing contact). The primary owner can't
  be demoted, suspended or removed, nor leave (`409 PRIMARY_OWNER`) until they transfer ownership.
  The last active owner can never stop being one (`409 LAST_OWNER`). Updates are conditional on the
  state that was checked, so two concurrent changes cannot both pass the guard (`409 CONFLICT`).
- **Transfer.** `POST …/transfer-ownership` makes an active member an owner *and* the primary
  owner; the caller stays an owner and may step down afterwards. Team workspaces only.
- **Status.** `suspended` members fail workspace context at once (403) but keep their record;
  reactivating takes a seat (`403 PLAN_LIMIT_REACHED`). You can't suspend yourself (400). `invited`
  is not settable: invitations are `WorkspaceInvite` documents, not memberships.
- Removing a member deletes their direct `ResourceShare` grants in the workspace.
- Personal workspaces have only their owner; every attempt to add someone is
  `403 PERSONAL_WORKSPACE`.

### Seats

`getEntitlements(workspace).limits.seats` (`platform/plans.md`; Team = 5 or the purchased
`billing.seats`, Enterprise unlimited, Free/Pro 1). Used = active members; pending = unexpired
invites, which reserve a seat (re-inviting an address that already has one needs no extra seat).
`assertLimit` → `403 PLAN_LIMIT_REACHED {limit: 'seats'}` on invite, accept and reactivation. The
check is a soft limit: two simultaneous accepts at the last seat can both pass.

## Invitations

| Method + path | Auth | Notes |
| --- | --- | --- |
| `POST /api/workspaces/:workspaceId/invites` `{ email, role }` | `workspace:members` | 201 `{ invite, inviteUrl, emailSent, refreshed }` |
| `GET /api/workspaces/:workspaceId/invites` | `workspace:members` | `{ invites: InviteView[] }`, unexpired only, never a token |
| `DELETE /api/workspaces/:workspaceId/invites/:inviteId` | `workspace:members` | link dies at once; `404 INVITE_NOT_FOUND` |
| `GET /api/invites/:token` | public, 60/10 min/IP | `{ workspaceName, role, email (masked), inviterName, expiresAt }` for the accept page |
| `POST /api/invites/:token/accept` | signed in; 30/10 min/IP and 20/10 min/user | `{ workspace, membership, alreadyMember }` |

- **Tokens.** 256 random bits (`base64url`), only the SHA-256 is stored (`tokenHash`, unique).
  Valid for 7 days (`INVITE_TTL_MS`; TTL index removes the document). The link is
  `${FRONTEND_URL}/invites/<token>`.
- **One per address.** `{workspaceId, email}` is unique (migration 100); inviting again replaces the
  token, role and expiry (`refreshed: true`), so an earlier link stops working. Concurrent first
  invites resolve through the unique index (upsert retry).
- **Roles.** `admin|editor|presenter|viewer`, up to the inviter's own rank. Owners are made by role
  change or ownership transfer, not by invitation.
- **Rate limits** on create: 60/hour/inviter and 5/hour per workspace+address.
- **The link is returned once, to the inviter** (`inviteUrl`), with `emailSent`. Mail is optional
  (`RESEND_API_KEY`); when it is off or the send fails the inviter can copy the link and pass it on.
  This is safe because accepting needs the *invited address*: a leaked link is useless to anyone
  whose verified email differs. With mail disabled the link is also logged (development only).
- **Accept** (`InvitesService.accept`): the token must be unexpired and its workspace a live team
  workspace (`404 INVITE_INVALID` for unknown, expired, used or revoked: indistinguishable); the
  signed-in user must have a verified email (`403 EMAIL_NOT_VERIFIED`) equal, case-insensitively, to
  the invited address (`403 INVITE_EMAIL_MISMATCH`, invite left untouched); a suspended member can't
  rejoin this way (`403 MEMBER_SUSPENDED`); seats are checked again. The invite is then **claimed
  with one atomic `findOneAndDelete`**, so of N simultaneous accepts exactly one wins and the rest
  get 404; the membership (`role` from the invite, `source: manual`) is created next, and the
  invite is restored if that fails. Someone already in the workspace consumes the invite and keeps
  their role (`alreadyMember: true`).
- Accepting does not switch the user's workspace; the frontend calls `POST /api/workspaces/:id/switch`.

## Sharing

`GET|PUT /api/shares?resourceType=presentation|folder&resourceId=<id>` runs in the
`X-Workspace-Id` workspace like the deck routes (`workspaceContext()`); the resource must belong
to it. Both need `deck:share` (editor and up) on the resource.

```ts
GET → { resource: {type, id, title}, shares: ShareView[], groups: {id, name, memberCount}[] }
PUT { shares: [{ principalType: 'user'|'group', principalId, role: 'editor'|'presenter'|'viewer' }] }  // complete set, ≤ 200
ShareView = { principalType, principalId, role, name, email|null, workspaceRole|null }
```

- PUT **replaces** the set but is applied as a diff (upsert changed principals, delete missing
  ones), so unchanged grants are untouched and concurrent edits to other principals survive.
  It returns the new list.
- Principals must be active members (users) or groups of the resource's workspace
  (`400 PRINCIPAL_NOT_IN_WORKSPACE`, `details.principalIds`). The role must not exceed the
  granter's own permissions on the resource (`403 ROLE_NOT_ASSIGNABLE`).
- Decks without a `workspaceId` (before migration 020) can't be shared (`409 NOT_SHAREABLE`).
- Folder shares: the Folder model is W3-B2's, so the folder is read from the raw `folders`
  collection (`_id`, `workspaceId`, `name`, `deletedAt`). **W3-B2 must delete a folder's
  `ResourceShare` documents (`resourceType: 'folder'`) when it deletes the folder**; deleting a deck
  already removes its shares (`crud.service.ts`). Nested folders: only the deck's direct folder is
  matched today; walk `parentId` in `loadShareGrants` if W3-B2 adds inheritance.
- Evaluation: `presentations/access.ts` (`authorizeDeck`, `canActOnDeck`) counts shares, so REST
  routes, host actions, the sessions list and the socket host join honour them. Other resource
  types (polls) have no shares.

## Audit log

`GET /api/audit?action&actor&cursor&limit` — `workspace:manage` (owner, admin) in the
`X-Workspace-Id` workspace; 120 requests/min/user. Not plan-gated (`platform/plans.md` has no audit
feature; only retention differs: `auditRetentionDays` → TTL on `expiresAt`).

```ts
{ events: [{ id, action, actorType, actor: {id,name,email}|null, targetType, targetId, ip, ua, meta, createdAt }],
  nextCursor: string|null,   // keyset on {createdAt, _id}; pass back as `cursor`
  actions: string[] }        // every action the workspace has recorded (first page only), for the filter
```

`action` is exact or a prefix ending in `*` (`member.*`); `actor` is a user id; `limit` 1–100
(default 50). Bad filters or cursors are 400. Events of other workspaces never appear.

Actions written by this package (always through `audit()`, fire-and-forget): `member.role.update`
(`meta {from,to,email}`), `member.status.update`, `member.remove`, `member.leave`,
`workspace.owner.transfer`, `invite.create`/`invite.refresh` (`meta {email, role, emailSent}`),
`invite.revoke`, `invite.accept`, `share.grant`/`share.update`/`share.revoke` (target = the deck or
folder; `meta {principalType, principalId, role, previousRole, title}`). Tokens and links are never
audited.

## Migration 100

`WorkspaceInviteModel.syncIndexes()` after removing duplicate `{workspaceId, email}` invites (keeps
the most recently updated). Idempotent. Nothing wrote invites before this package.

## Owner set-up

Optional: `RESEND_API_KEY` + `RESEND_FROM_EMAIL` so invites are emailed (otherwise inviters copy
the link; `emailSent` tells the UI which). `FRONTEND_URL` must be the public frontend origin: it
builds the invite link. A plan with more than one seat is needed before a team can invite anyone
(`bun scripts/set-plan.ts <workspace> team`, or Stripe via W3-C).

## Tests

- `tests/tenancy.shares.test.ts`, `tests/platform.policy.test.ts` — matrix cells, share evaluation.
- `tests/members.unit.test.ts` — rank rules, tokens, schemas.
- `tests/integration/members.http.test.ts` — members CRUD and guards, invites (hashing, single use,
  email match, expiry, races, seats, rate limit), shares (roles, groups, folders, workspace
  boundary, cleanup), audit filters and paging, migration 100.
- `tests/integration/tenancy-isolation.test.ts` — route table + cross-workspace matrix + sockets.
