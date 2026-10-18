---
summary: Unified library (polls + decks as cards, cursor pagination, search), "Convert to presentation" for polls, and the legacy-quiz copy (migration 010).
status: active
last_updated: 2026-10-19
---

# Library Module (`src/modules/library/`)

Polls stay their own entity (`/p/[id]`, analytics, MCP are unchanged). The library is the one
list of everything a workspace owns, and the bridge from a poll to an audience-paced deck.

| File | Owns |
|---|---|
| `library.route.ts` | Mounted at `/api/library` (`src/http/routes.ts`). |
| `library.controller.ts` | Parses query strings (Express 5 `req.query` is read-only, so not `validate()`), builds the context, audits conversions. |
| `library.schema.ts` | `libraryQuerySchema`, `convertQuerySchema`. |
| `library.query.ts` | Pure parts: cursor codec, filters (scope, status, folder, title), merge, document → card mappers. |
| `library.service.ts` | `LibraryService.list` — runs the two queries and the counts. |
| `convert.service.ts` | `pollToDeckDraft` (pure mapping) and `ConvertService.convertPoll`. |
| `library.types.ts` | Wire types (`LibraryCard`, `LibraryPage`, `LibraryCounts`). |

## `GET /api/library`

`authenticate()` → `workspaceContext()` → `assertCan(req, 'deck:read')`.

Query: `type=all|poll|presentation` (default `all`), `status=draft|live|ended`, `folderId=<id>|root`,
`q` (≤100 chars, case-insensitive title substring, regex-escaped), `cursor`, `limit` (1–60, default 24).
Empty values count as unset; anything else malformed → 400.

Response `data`:

```ts
{
  items: LibraryCard[];          // newest updatedAt first, ties by id
  nextCursor: string | null;     // opaque; null on the last page
  counts?: { all, poll, presentation, live, draft };  // first page only (no cursor)
}
```

`counts` honour `folderId` and `q` but not `type`/`status` (tab badges and dashboard stats).

Card (`entityType`, `id`, `title`, `status`, `createdAt`, `updatedAt`, `stats`, `details`):

| | `status` | `stats` | `details` |
|---|---|---|---|
| poll | `draft` unpublished · `live` published, not closed, not expired · `ended` closed or expired | `questionCount`, `responseCount` (from `analytics.totalResponses`) | `pollType`, `isAnonymous`, `expiresAt`, `isResultsPublished`, `convertedPresentationId` |
| presentation | `draft` · `live` (`lobby`/`active`) · `ended` | `slideCount` | `phase` (raw status), `joinCode`, `pace` (default `presenter`), `legacySource` (`poll`/`quiz`/null), `slideTypes` (≤6 distinct) |

**Scope.** Items whose `workspaceId` is the current workspace. Items without one (created before
migration 020 backfills them) are listed only in their creator's **personal** workspace, only for
the creator — where 020 will put them. Decks with `deletedAt` set are hidden.

**Pagination.** Each collection is read sorted `{updatedAt:-1, _id:-1}` with `limit + 1` documents
after the cursor (`updatedAt < u` or `updatedAt = u and _id < id`); the two runs are merged and cut
at `limit`. The cursor is base64url JSON `{u: ms, i: id}` of the last card. An item edited between
pages moves to the top and may be missed by an open scroll; nothing else is skipped or repeated.
Index: `{workspaceId:1, updatedAt:-1, _id:-1}` on `polls` and `presentations` (migration 011).

## `POST /api/library/convert/poll/:pollId[?force=true]`

`authenticate()` → per-user rate limit (20/min) → `workspaceContext()` → `assertCan('deck:create')`
and `assertCan('deck:edit', poll)` (it records the conversion on the poll; pre-workspace polls fall
back to their creator).

Copies the questions only — never responses — into a new deck created through
`PresentationService.createPresentation` and validated by the presentations request schema, so
the deck opens and saves in the builder:

| Poll | Deck |
|---|---|
| `title` | `title` (≤120 chars) |
| — | `pace: 'audience'`, `legacy: {source:'poll', sourceId}`, `workspaceId` = current workspace |
| each question | one `select_answer` slide: `question` (≤500), `options[].text` (≤200), `timeLimit: 30`, `scoreDependsOnTime: false` |
| `type: 'multiple'` | `config.allowMultiple: true` |
| `explanation` | `config.explanation` (never sent to participants) |
| POLL | `points: 0`, no correct option (ungraded) |
| TRIAL `correctOptionIndices` / `points` | `options[i].isCorrect` / `points` (rounded, 1–10000) |
| TRIAL `passingScorePercentage` | `settings.audiencePaced.assessment = {enabled: true, passingScorePercentage, maxAttempts: null}` (null = unlimited: a TRIAL lets respondents retry until they pass) |
| `isMandatory`, `isAnonymous`, `expiresAt`, results | not carried over |

`pace`, `legacy`, `workspaceId` and `settings.audiencePaced.assessment` are written with a
`$set {strict:false}` right after the create, so they persist whatever presentation schema is in
force. Polls a deck cannot hold (more than 8 options, more than 50 questions, an unmarked TRIAL
draft) → 400 `POLL_NOT_CONVERTIBLE` naming the question.

**Idempotent per poll.** The poll's `convertedPresentationId` (Poll model, default null; written
without touching `updatedAt`) points at the deck. A second call returns it (`200`,
`{created: false, presentation}`) while it exists and is not trashed; `?force=true` makes a fresh
copy (`201`) and repoints the poll, leaving the earlier deck alone. The pointer is set with a
conditional update on the value the request read, so racing conversions create exactly one deck:
losers delete theirs and return the winner's. Audit action `poll.convert`.

## select_answer additions (in `presentations/slides/types/select_answer.ts`)

Additive, for converted polls; single-select decks behave exactly as before (golden tests).

- `slide.config`: `{allowMultiple = false, explanation = ''}` (Zod `selectAnswerSettingsSchema`,
  null when absent). `selectAnswerSettings(slide)` reads it with defaults.
- Multi-select: the participant slide gains `allowMultiple: true`; answers send
  `payload: {optionIndices: number[]}` (a legacy `optionIndex` counts as one pick). Picks must be
  unique and in range; correct = exactly the correct set; each pick increments `dist`; stored as
  `payload.optionIndices` (export cell joins the option texts).
- Ungraded: a slide worth `points: 0` needs no correct option. The presenter-paced engine still
  records its answers as `scored: true, isCorrect: false` (0 points); the audience-pace engine
  (W2-F) should treat 0-point select slides as unscored.

## Migration 010 — legacy quizzes

`src/migrations/010-legacy-quizzes.ts` (`copyLegacyQuizzes(db, log)`), raw collection operations:

- No-op when `quizzes` is missing or empty.
- `quizzes` → `presentations`: the document as is, keeping `_id` (old `/quiz/host/:id` links →
  `/presentation/host/:id` still resolve) unless a deck holds it (then a new id), keeping the join
  code (`/quiz/play/:code` → `/live/:code`) unless a deck or another quiz holds it (then a fresh
  unused 6-digit code). Live statuses (`lobby`, `active`, `question`, `reveal`, `leaderboard`) become
  `ended` — no Redis state survives the move. Marked `legacy: {source:'quiz', sourceId}`.
- `quizparticipants` / `quizanswers` → `presentationparticipants` / `presentationanswers` with
  `quizId` renamed `presentationId` (= the copy's id), `_id`s kept so answers still point at their
  participants.
- Idempotent: quizzes with a `legacy.sourceId` copy are skipped; children are inserted unordered and
  duplicates ignored, so an interrupted run completes on the next one.
- The legacy collections stay; drop them by hand once checked. Runs before 020 (workspace backfill)
  and 030 (sessions), which then treat the copies like any deck.

Migration 011 creates `library_workspace_updated` on `polls` and `presentations`.

## Tests

- `tests/library.query.test.ts` — cursor, merge order, filters, scope, cards, query schemas.
- `tests/library.convert.test.ts` — POLL/TRIAL mapping, clipping, unconvertible polls.
- `tests/presentations.selectAnswer.test.ts` — multi-select, ungraded slides, config schema.
- `tests/integration/library.test.ts` — union, pagination (incl. ties), type/status/folder/search
  filters, isolation, workspace scope, convert POLL/TRIAL, idempotency, races, polls still voting,
  converted deck played live.
- `tests/integration/legacyQuizzes.test.ts` — migration 010 on fixture data (id/code clashes,
  re-runs, half-finished runs, runner, copies hosted).
