---
summary: Session history, reports, CSV/XLSX/PDF export, public results links, participant take-home and session deletion (W2-C, Epic 5).
status: active
last_updated: 2026-10-19
---

# Sessions: history, reports, export, share, take-home

Code: `backend/src/modules/sessions/`. Wire types: `contract.ts` (mirrored in the frontend's
`features/sessions/types.ts`). A session is one run of a deck (`PresentationSession`; model and
live engine: [`presentations-live.md`](./presentations-live.md)). This module only reads
what the engine stored (plus `share`) and never changes a live session.

## Authorization

Every host route runs `authenticate()` + `workspaceContext()`. A session has no policy of its
own: it is authorized through its deck (`workspaceId`, or `creatorId` for decks from before
migration 020), so rights on a deck move with its runs. A missing or trashed deck, an unknown
session and a malformed id are all 404; a session of another workspace is 403 (the denial never
says why).

| Route | Action | Roles that hold it |
| --- | --- | --- |
| `GET /api/sessions`, `GET /:sid` | `session:read` | viewer and up |
| `GET /:sid/export.{csv,xlsx,pdf}` | `session:export` + plan feature | presenter and up |
| `POST|DELETE /:sid/share` | `session:share` | editor and up |
| `DELETE /:sid` | `deck:delete` | editor and up |

The report's `access` object tells the UI which of export/share/delete the caller may do, and the
share token is only sent to members who may share (others get `token: null`).

## API

| Route | Notes |
| --- | --- |
| `GET /api/sessions?presentationId&cursor&limit` | Newest first (`startedAt`, `_id`), `limit` 1-100 (default 20), opaque `cursor` from `nextCursor`. Live sessions show Redis counts. 404 deck, 400 bad cursor. |
| `GET /api/sessions/:sid` | The report (`SessionReport`): summary, `slides[]`, `leaderboard`, `participants[]`, `share`, `access`, `exports`. |
| `GET /api/sessions/:sid/export.csv` | Free plan. |
| `GET /api/sessions/:sid/export.xlsx`, `.pdf` | `requireFeature('export_xlsx' / 'export_pdf')`: 403 `FEATURE_NOT_IN_PLAN` with `details {feature, plan}` on the free plan. |
| `POST /api/sessions/:sid/share` | Body `{includeNames?, expiresAt? (ISO | null), rotate?}`. Ended sessions only (409 `SESSION_LIVE`). |
| `DELETE /api/sessions/:sid/share` | Disables the link; `null` when the session was never shared. |
| `DELETE /api/sessions/:sid` | Ended sessions only (409 `SESSION_LIVE`). |
| `GET /api/sessions/:sid/me?participantId&token` | Participant take-home, no account. |
| `DELETE /api/sessions/:sid/participants/me` | Body `{participantId, token}`: the participant removes their own answers (W4-C). Ended sessions only (409 `SESSION_LIVE`). |
| `GET /api/public/results/:token` | Public aggregated results, no account. |

Rate limits (Redis, fail open): exports and share changes 30/min per user; take-home 600/min per
IP (classroom NAT, everyone opens it at the end); participant removal 60/min per IP; public results
300/min per IP.

### Report

- Ended session: per-slide results come from the reconciled `slideStats`; live session: from the
  Redis aggregates (`computeSlideDistributionHelper`). Each slide carries the registry's
  `distribution` (`kind` options / text / words / scales / ranking / responses / ... as the type
  defines) and the slide as it ran (deck snapshot, answer keys included, **notes removed**) so the
  frontend can render the type's `StageView` in `mode="report"`.
- `participants[]` lists everyone ranked: score desc; equal scores in the order of the stored final
  leaderboard (the order participants saw on screen); then join order. The exports and the
  take-home rank use the same order, so every number agrees.
- `participationRate` = answers / (participants x shown response slides).

### Take-home

`GET /:sid/me` is public but needs the participant's own token (constant-time comparison, 401
otherwise; 404 for an unknown participant or a participant of another session; 403 if kicked).
Responses are `Cache-Control: no-store`. It returns the participant's answer per shown response
slide, and while a session is live nothing leaks early: correctness and points appear once the
slide stopped accepting answers, the correct answer once the slide is revealed (or the session
ended). Answers not yet written behind to Mongo are read from the Redis results hash.

### Participant self-removal (W4-C)

`eraseParticipant` (`DELETE /:sid/participants/me`) checks the token like the take-home (401 wrong
token, 404 unknown), then deletes the participant's answers, their Q&A questions (with the upvotes on
them) and the upvotes they cast (each upvoted question's `upvoteCount` drops by one), and the
participant document. Their row in the stored `finalLeaderboard` keeps its rank and score under
`REMOVED_PARTICIPANT_NAME` ("Removed participant"), so nobody else's rank moves. `slideStats` and the
session counts are aggregates and stay. Their entries in the session's Redis results, names and tokens
hashes (kept 6 h after the end) are removed. Afterwards the take-home answers 404.

### Deleting session data

`purgeSessionData(session)` removes a session with its participants, answers, Q&A and Redis keys,
without an access check. `deleteSession` (the route) authorizes and audits around it; the privacy
module's retention job and account purge call it directly (`modules/privacy.md`).

### Sharing

A share is `session.share = {token, enabled, includeNames, createdAt, expiresAt}`. The token is 192
random bits (base64url, 32 characters) with a unique sparse index. Disabling keeps the token (so
re-enabling restores the same link); `rotate: true` issues a new one and kills the old links.
Enabling with a lapsed `expiresAt` kept from before is refused (400): send a new `expiresAt` or
`null`.

`/api/public/results/:token` answers 404 for anything not currently shared (bad format, unknown,
disabled, expired, live session, trashed deck). It serves ended sessions only and returns the title,
run number, dates, counts and per response slide: the type, label, answer count, `distribution`
and the **participant-facing slide** (registry allow-list: no notes, no answer keys). Names appear
only with `includeNames` (top 10: rank, name, score, correct count). Never present: notes, emails,
internal ids (session, participant, user, workspace), participant tokens, join code. Free-text
slides (open ended, word cloud) show the submitted text without authorship; owners should know
that when they enable a link. Headers: `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`.

## Exports (`export/`)

Streamed with backpressure; the data is loaded before the first byte so lookup errors still
produce a JSON error, and a failure mid-stream destroys the response. Participants are read in
batches of 500 with their answers, so memory stays bounded for large sessions.

- **Rows are generic.** `export/rows.ts` builds one row per participant x response slide through the
  slide registry (`exportColumns` / `exportCells`). Nothing switches on a slide type: a type
  registered later (W2-E) exports with no change here. Types without the hooks fall back to the
  stored text, option index or JSON payload.
- **CSV** ("Responses"): `Rank, Participant, Participant ID, Total score, Slide, Slide type,
  Question, Answered, Answer, Correct, Points, Response time (s), Answered at`; UTF-8 with BOM,
  RFC 4180 quoting, CRLF.
- **XLSX** (exceljs streaming writer): sheets `Summary`, `Results` (each slide's results as label ->
  value), `Responses` (same rows as the CSV), `Participants` (one row per participant, every slide's
  export columns side by side).
- **PDF** (pdfkit, built-in Helvetica): title, key numbers, one bar chart per response slide, top 10
  leaderboard. Characters outside WinAnsi (emoji, CJK) print as `?`.
- **Formula injection:** text cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a
  leading apostrophe in CSV and XLSX; numbers are never touched.
- File names: `<slug-of-title>-run-<n>.<ext>` (ASCII), `Content-Disposition` exposed to the browser.
- Each export writes a `session.export` audit event.

## Deletion

`DELETE /:sid` removes the session, its participants and answers, the leftover Redis keys
(`allSessionKeys`) and, once W2-B has created them, the session's Q&A questions and upvotes
(collections `qnaquestions` / `qnaupvotes`, only touched when present). The deck's `sessionCount` is
not decremented, so run numbers are never reused. Audited as `session.delete`. Retention
(`retainUntil`, W4-C) purges through the same data, not this route.

## Errors

`SESSION_LIVE` (409: share or delete while the session runs). Plus the platform codes
`FORBIDDEN`, `FEATURE_NOT_IN_PLAN`, `PARTICIPANT_KICKED`.

## Tests

- Unit: `tests/sessions.export.test.ts` (cells, CSV/XLSX escaping, registry-driven columns, result
  summaries, PDF writer), `tests/sessions.service.test.ts` (share tokens, cursors, schemas).
- Integration (`tests/integration/sessions.reports.test.ts`): 200 scripted participants through
  the real join/answer routes; `slideStats`, a Mongo aggregate, the report, CSV totals and XLSX
  totals all agree. Plus plan gating, pagination, live reports, take-home auth, share lifecycle and
  leak checks, deletion, workspace isolation and roles, rate limits.

## Not yet

- Q&A section in the report: TODO once W2-B's `qnaquestions` model exists (list the session's
  questions with their votes and status; the export then gets a "Q&A" sheet).
