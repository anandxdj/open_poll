# Retention

How long each kind of data is kept and what deletes it. Jobs run in the backend's scheduler
(`backend/src/common/jobs`), hourly, on one instance at a time.

| Data | Kept | Deleted by |
| --- | --- | --- |
| Session results (session, participants, answers, Q&A) | The workspace's choice in Settings, Workspace, Data retention, capped by the plan: Free 1 year, Pro 2 years, Team 3 years, Enterprise unlimited. Fixed when the session ends (`retainUntil`). | `privacy-retention-purge` job, or the host deleting the session. |
| Live session state in Redis | 6 hours after the session ends | Redis expiry |
| Polls, decks, poll responses | Until deleted by the workspace | The workspace, or account purge for a personal workspace |
| Audit events | Free 30 days, Pro 90, Team 365, Enterprise 730 | MongoDB TTL index (`expiresAt`) |
| Data export records | 90 days | MongoDB TTL index |
| Workspace invitations | 7 days, or until accepted or revoked | MongoDB TTL index, or the accept/revoke |
| Accounts waiting for deletion | 30 days | `privacy-account-purge` job |

A shorter retention setting applies to sessions that end after the change; sessions that already
ended keep the date they were given.

## Account deletion

`DELETE /api/me` needs a sign-in less than 5 minutes old, or the password confirmed within the last
5 minutes. It is refused while the user is the only owner of a team workspace with other members
(`SOLE_OWNER`) or while a workspace that would be deleted still has a paid subscription
(`ACTIVE_SUBSCRIPTION`).

Right away: refresh token removed, every access token and MCP token rejected, MCP tokens deleted,
an email says when the account goes. Signing in during the next 30 days cancels the deletion.

After 30 days the purge job:

1. Deletes the personal workspace and every team workspace the user was alone in, with all their
   polls, responses, decks, sessions, participants, answers, Q&A, uploaded files (also from object
   storage), imports, invitations, groups, shares and usage counters.
2. Removes the user from the other team workspaces. If they were still its only owner, the longest
   standing admin (else member) becomes owner. What they made there stays.
3. Gives each poll answer they sent to other polls its own anonymous id (`deleted:<id>`).
4. Clears IP address and browser from their audit events.
5. Keeps the user record as a tombstone: name "Deleted user", email `deleted-<id>@deleted.invalid`,
   no password, sign-in methods or picture. Content left in team workspaces still has an author,
   and the original email can sign up again.
