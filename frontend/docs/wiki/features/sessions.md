---
summary: Session history, the per-session report, exports, public results links (/r/[token]), participant results (/live/[code]/summary) and the end-screen links.
status: active
last_updated: 2026-10-19
---

# Sessions (`features/sessions/`)

Every run of a deck is a session. This feature lists them, reports on one, exports it, shares it
and shows a participant their own results. Backend contract and rules:
`backend/docs/wiki/modules/sessions.md` (wire types mirrored in `types.ts`).

## Routes

| Route | Page | Who |
| --- | --- | --- |
| `/presentations/[id]/sessions` | `SessionsList`: runs newest first (run number, date, status badge, participants, responses, shared badge), "Present again", load more | signed-in members (the API enforces it; `/presentations` is not yet a protected prefix of the proxy, so a signed-out visitor sees a load error instead of the login page) |
| `/presentations/[id]/sessions/[sessionId]` | `SessionReportView`: stats, one chart per response slide, leaderboard, participants table, Export, Share, Delete | signed-in members |
| `/r/[token]` | `PublicResultsView`: aggregated results of a shared session. `noindex` (metadata `robots` + `referrer: no-referrer`) | anyone with the link |
| `/live/[code]/summary?sid=` | `ParticipantSummary`: the participant's own answers, correctness, points, rank | the participant, from this browser's storage |

All four pages are thin server components that await `params` and render a client view inside
`SessionsIntlProvider` (messages `live` + `sessions`; on the summary page it nests inside the live
layout's provider and replaces it). The sidebar has no new item: decks reach their history from the
library card menu ("Session history", one hunk in `features/library/components/LibraryCard.tsx`)
and from the host end screen.

## Files

| File | Role |
| --- | --- |
| `types.ts` | Wire types (report, list, share, public results, take-home). |
| `query.ts` | Pure logic, unit tested in `tests/unit/sessions.query.test.ts`: formatting, paths and the public link, export options by plan, share expiry choices, report slide to StageView data (`toStageSlide`), participant search and paging, take-home tones. |
| `credentials.ts` | Reads the participant's stored identity: `openpoll_participant_{code}_{sessionId}` (W1-A2), newest session when `?sid=` is missing, and the older per-code key as a fallback. |
| `api/sessions.ts` | Host calls through `lib/api-client` (bearer + workspace header); `downloadExport` (blob + `Content-Disposition` name), `readBlobError`; public, take-home and `eraseMyAnswers` calls through a plain axios client with no credentials. |
| `hooks/` | `useSessionList` (cursor pages), `useSessionReport` (refreshes every 5 s while the session is live), `usePublicResults`, `useTakeHome` (refreshes every 8 s while live; resolves a legacy per-code entry to its session through `/presentations/code/:code` and `/me`). |
| `components/` | `SessionsList`, `SessionReportView` (+ `ReportContent`), `SlideResultCard`, `LeaderboardPanel`, `ParticipantsTable`, `ExportMenu`, `ShareDialog`, `DeleteSessionDialog`, `PublicResultsView` (+ `PublicResultsContent`), `ParticipantSummary` (+ `TakeHomeContent`), `EndScreenLink`, `ui.tsx`. |
| `register.ts` | Registers the `endScreen` slot entry `sessions:end-link`; imported by `features/registrations.ts`. |
| `SessionsIntlProvider.tsx` | next-intl provider for these screens; strings in `messages/en/sessions.json` (namespace `sessions`, added to `i18n/messages.ts`). |

## Look

The signed-in pages follow the app screens (`../ui/design-system.md`): a back link, a 36/48px h1 with the
run, its status pill and start time under it, actions on the right (Delete as a ghost destructive button,
Export and Share as outline), the key numbers as one hairline strip (`StatStrip`), section titles at 20px and
the leaderboard and participants as hairline rows in one card. `/r/[token]` and `/live/[code]/summary` use
`PublicPageShell` (brand bar, one column). Shared blocks are in `components/ui.tsx` (`StatusBadge`,
`StatStrip`, `BackLink`, `SectionTitle`, `LiveNotice`, `MessageCard`, `Skeleton`, `page`).

## Report

- Per response slide the card draws the slide type's own `StageView` in `mode="report"` on a dark
  stage panel, from the slide as it ran (the report carries the deck snapshot with answer keys, notes
  removed) and its `distribution`. A slide type registered later (its `runtime.ts` entry) shows up
  with no change here; unknown types render only their heading.
- Slides that never ran are listed in one line, not charted. Content slides are not part of the report.
- A live session shows a banner and refreshes quietly; Share and Delete wait for the end (the dialog
  explains; Delete is hidden).
- The leaderboard shows 10 rows (all ranked entries on request); the participants table searches by
  name and pages 25 at a time. Names render as text only.

## Export and plan gating

`ExportMenu` lists CSV, Excel and PDF from `report.exports`. Included formats download through the
API client (the endpoint needs the bearer token, so there is no plain link) and are named by the
server's `Content-Disposition`. A format outside the plan has a lock and opens a dialog ("Excel
export isn't part of your Free plan", CSV stays free, link to `/settings/workspace` which lists the
plan); a 403 `FEATURE_NOT_IN_PLAN` from the server (plan changed meanwhile) opens the same dialog. The
menu is hidden for roles without `session:export` (`report.access.export`).

## Sharing

`ShareDialog` (mounted only while open, so each opening starts from the saved state): create the link,
copy it, "Show participant names" (off by default: results only), expiry (never, 24 h, 7 d, 30 d, or
keep), turn off, create a new link (the old one stops working). Only members with `session:share`
see the button and the token. Expired links restart from "In 7 days" because the server refuses a
lapsed expiry.

## Participant results

`/live/[code]/summary` never shows anything without the participant's own token, which is read from
this browser's storage and sent to `GET /api/sessions/:sid/me` (the server compares it in constant
time). While the session runs, correctness appears per slide once that slide closed and the correct
answer once it was revealed; the page refreshes itself until the session ends. Without stored
credentials it says so and links to `/live`.

Once the session ended, "Remove my answers" (W4-C) asks to confirm, then calls
`DELETE /api/sessions/:sid/participants/me` (`eraseMyAnswers`) with the stored credentials, forgets
them on this device and shows "Your answers were removed". `TakeHomeContent` only offers it when the
page passes `onRemove`.

The end screens link here through the `endScreen` slot: participants get "See my results"
(`summaryPath(joinCode, sessionId)`; the session id is read defensively from the participant state
the backend sends), the host gets "Session report" (`/presentations/[id]/sessions`). The slot entry
wraps itself in `SessionsIntlProvider` because the live routes only load the `live` messages.

## Tests

- Unit: `tests/unit/sessions.query.test.ts`, `sessions.credentials.test.ts`,
  `sessions.components.test.tsx` (report, public and take-home content rendered to markup, slot
  links, API client calls, message catalog).
- E2E: `e2e/sessions.spec.ts` (see [`../testing/e2e.md`](../testing/e2e.md)): a deck is run through
  the real join/answer routes, then the history, report, CSV download, locked Excel dialog, share
  link opened in a signed-out context (no names, `noindex`, then names on, then off), participant
  results with their own and someone else's token, delete; Excel and PDF downloads on the Pro plan
  (set with `backend/scripts/set-plan.ts`, restored to free); the library menu entry and a live
  session's history row.
