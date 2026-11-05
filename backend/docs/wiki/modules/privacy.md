---
summary: Privacy (W4-C): data export, re-auth, account deletion and the 30-day purge, session retention purge, participant self-removal.
status: active
last_updated: 2026-10-26
---

# Privacy (`src/modules/privacy/`)

The signed-in user's own data: download it, delete the account. Plus the two hourly jobs that
delete what is due. Compliance view of the same: `docs/compliance/{data-inventory,retention,anonymity}.md`.

## Routes (mounted at `/api/me`)

User-level, no workspace context (allow-listed in the tenancy test). All `authenticate()` and a
per-user rate limit.

| Route | What |
| --- | --- |
| `GET /privacy` | `PrivacyStatus`: `hasPassword`, `reauthUntil` (or null), `deletionGraceDays` (30), `workspaces {deleted, left}`, `blockers {soleOwner, subscriptions}`, last 5 `exports`, `exportsLeftToday`. |
| `POST /export` | The zip itself (`application/zip`, `Content-Disposition: attachment; filename="openpoll-data-YYYY-MM-DD.zip"`). 3 per rolling 24 h (429 `EXPORT_LIMIT`). |
| `POST /reauth` | Body `{password}`. Opens a 5-minute window in Redis (`privacy:reauth:<userId>`). 400 `WRONG_PASSWORD` (not 401: the client would refresh), 400 `NO_PASSWORD` for accounts without one. |
| `DELETE /` | Schedules deletion; returns `{purgeAt}` and clears the refresh cookie. 403 `REAUTH_REQUIRED`, 409 `SOLE_OWNER` / `ACTIVE_SUBSCRIPTION` with `details.workspaces`. |

## Export (`privacy.export.ts`)

`buildUserExport(userId)` zips (fflate, level 6) a README and JSON files: `profile`, `workspaces`,
`polls`, `presentations` (created by the user, in workspaces they still belong to or from before
workspaces), `sessions-hosted` (summaries, no participant data), `poll-responses` (answers they sent
signed in), `uploads`, `imports`, `mcp-tokens` (label, prefix, last 4), `activity` (their audit
events), `exports`. Each file holds at most 10,000 rows, newest first (`EXPORT_MAX_ROWS`; the README
names cut files). Never included: password hash, token hashes, refresh token, answers other people
gave. The archive is built in the request and never stored; `DataExportJob` (`userId, status, bytes,
objectKey, expiresAt`, 90-day TTL, migration 160) records it for the daily limit and the page.
`objectKey`/`expiresAt` stay null until exports outgrow a request.

## Account deletion

Proof of identity, either:

- the access token's `authTime` claim (seconds; set by `startSession` at every sign-in and kept by
  refreshes) is under 5 minutes old, or
- the password was confirmed through `POST /reauth` under 5 minutes ago.

`deletionImpact(userId)` sorts the user's active workspaces into deleted with the account (personal,
and team workspaces with no other active member) and left. Blockers: the user is the only owner of a
team workspace with other members (`SOLE_OWNER`), or a workspace deleted with the account has a
Stripe subscription that still bills (active, trialing, past_due, unpaid, not `cancelAtPeriodEnd`).

`requestDeletion` sets `User.deletionRequestedAt`, unsets the refresh token, deletes MCP tokens,
audits `account.deletion_request` and emails the purge date (`sendAccountDeletionEmail`). From then
`isAccountUsable(user)` is false: `authenticate()`, token refresh and MCP tokens reject the account.
A sign-in (password, Google, OIDC) through `startSession` clears `deletionRequestedAt`, audits
`account.deletion_cancel` and returns `restored: true` (the password login response carries it).

## Jobs (`privacy.purge.ts`, registered when the route module loads)

| Job | Every | Does |
| --- | --- | --- |
| `privacy-account-purge` | hour | `purgeAccount` for users with `deletionRequestedAt` 30+ days ago and no `deletedAt`. |
| `privacy-retention-purge` | hour | `purgeSessionData` for ended sessions with `retainUntil <= now` (set at session end from the workspace's `retentionDays` capped by the plan). |

`purgeAccount(userId)`:

1. `purgeWorkspace` for the personal workspace and team workspaces with no other active member:
   polls with responses and analytics, decks with every session (`purgeSessionData`), media (also
   deleted from storage), imports, invites, groups, shares, usage counters, members, the workspace.
2. Leaves the other workspaces (membership, group membership, user shares removed). If nobody is
   owner any more, the longest standing owner/admin/member becomes owner (`ownerId` too). Seats
   are synced.
3. Pre-workspace polls and decks with `creatorId` = the user and no workspace are purged.
4. Poll responses they sent elsewhere get `respondentId: deleted:<responseId>`; their audit events
   lose `ip` and `ua`.
5. The user document becomes a tombstone (`DELETED_USER_NAME` "Deleted user",
   `deleted-<id>@deleted.invalid`, no password, identities, picture, tokens; `active: false`,
   `deletedAt`). References from team content still resolve; the email can sign up again.

Both jobs are idempotent and check `signal.aborted` between items. A failed account purge is
logged and retried next hour.

## Tests

`tests/integration/privacy.test.ts`: status, export contents and isolation, the daily limit,
re-auth (stale token, wrong and right password), both blockers, sign-out everywhere and cancel by
signing in, the purge (tombstone, workspaces, team content kept, anonymized responses, audit
scrub, grace period respected), the retention purge, participant self-removal (live refused, wrong
token, leaderboard name, take-home 404).
