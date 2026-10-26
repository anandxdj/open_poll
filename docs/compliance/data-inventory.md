# Data inventory

What Open Poll stores about people, where, and how it leaves. Written for whoever runs an
Open Poll server and answers data requests. Field names are the backend's
(`backend/src/modules/**`); retention is in [retention.md](retention.md).

## Account holders (hosts, editors, admins)

| Data | Where | Notes |
| --- | --- | --- |
| Email, name, picture, locale | `users` | Picture and name come from Google or the SSO provider when used. |
| Password | `users.password` | bcrypt hash (cost 12). Never exported or logged. |
| Sign-in methods | `users.identities` | Provider and subject (Google, OIDC, later SAML). |
| Session tokens | `users.refreshToken` | SHA-256 of the refresh token; access tokens are not stored. |
| Workspace memberships | `workspacemembers` | Role, status, how they joined. |
| Content they create | `polls`, `presentations`, `mediaassets`, `importjobs` | Belongs to the workspace; `creatorId`/`uploaderId` point to the user. |
| Sessions they run | `presentationsessions.hostUserId` | |
| Poll answers while signed in | `responses.respondentId` | The user id. |
| AI assistant (MCP) tokens | `mcptokens` | SHA-256 hash, prefix, last 4 characters. |
| Activity | `auditevents` | Action, target, IP address, browser (user agent). |
| Data exports | `dataexportjobs` | Date and size only; the archive is not kept. |

## Participants (no account)

| Data | Where | Notes |
| --- | --- | --- |
| Nickname | `presentationparticipants.name` | Typed by the participant ([anonymity.md](anonymity.md)). |
| Device id | `presentationparticipants.deviceId` | Random id from the participant's browser, so a rejoin keeps the same seat. |
| Participant token | `presentationparticipants.token` | Secret that proves the participant on later requests. |
| Answers, score | `presentationanswers`, participant `score` | |
| Q&A questions and upvotes | `qnaquestions`, `qnaupvotes` | Author name only when the question is not anonymous. |
| Live state | Redis `live:session:*` | Copies of the above while the session runs, kept 6 hours after it ends. |

## Poll respondents

`responses.respondentId` is the user id (signed in), `guest:<email>:<name>` (non-anonymous poll
answered with a guest token) or `anon:<ballot>` (anonymous poll).

## Requests from people

| Request | How |
| --- | --- |
| Access / portability | The user downloads a zip from Settings, Privacy (`POST /api/me/export`). |
| Erasure (account) | Settings, Privacy, Delete account (`DELETE /api/me`). Signed out at once, purged after 30 days. |
| Erasure (participant) | "Remove my answers" on the participant's results page (`DELETE /api/sessions/:id/participants/me`). |
| Erasure (poll respondent, guest) | No self-service yet: an admin deletes the response in the database. |

What an account purge does is in [retention.md](retention.md#account-deletion).
