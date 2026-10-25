---
summary: Unified library at /polls — polls and decks as one card list, URL filters, infinite scroll, card actions and "Convert to presentation".
status: active
last_updated: 2026-10-25
---

# Library (`features/library/`)

`/polls` is the creator's home: every poll and presentation deck of the current workspace in
one list, backed by `GET /api/library` (backend: `backend/docs/wiki/modules/library.md`). The
sidebar item is "Library"; `/presentations` redirects to `/polls?type=presentation`.

| File | Role |
|---|---|
| `types.ts` | Wire types (`LibraryCard` = poll or deck card, `LibraryPage`, `LibraryCounts`) and `LibraryFilters`. |
| `query.ts` | Pure logic, unit tested in `tests/unit/library.query.test.ts`: URL ⇄ filters (`parseLibraryFilters`, `filtersToSearch`, `filtersKey`), request params, page merging (`mergeLibraryItems` dedupes by `entityType:id`), count adjustments after delete/close, card links and labels, empty-state copy. |
| `api/library.ts` | `fetchLibraryPage`, `convertPollToPresentation(pollId, {force})`, `deleteLibraryItem`, `closePoll`. |
| `hooks/useLibrary.ts` | First page per filter set, cursor pages via `loadMore`, `remove`/`replace` for optimistic updates. Responses for stale filters are dropped. |
| `components/LibraryView.tsx` | Page header (h1 "Library", then New poll / Import / New deck; New deck is the page's one ember button; Import is `features/imports`, see `imports.md`), a hairline stat strip from `counts` (All items, Live now with a green dot, Drafts), underline type tabs with mono counts, status select, debounced search, grid, infinite scroll (IntersectionObserver on a "Load more" sentinel). `LibraryCardSkeleton` is the loading card, also used by the page's Suspense fallback. |
| `components/LibraryCard.tsx` | One card per entity with its actions and confirm dialogs. The top is a graph-paper preview (`aria-hidden`): status pill, "Updated …", and a picture of the item's kind (a dark mini screen with one tile per slide type for decks, a ballot sheet for polls, a checked row for assessments), never of results. The title link is stretched over the card (`after:absolute`) and opens the item; the menu and action buttons sit above it (`relative z-10`). Card actions use `outline` and `ink` buttons; only Resume (a running deck) uses the ember accent. |

## Filters live in the URL

`?type=all|poll|presentation&status=draft|live|ended&q=…` (defaults omitted). `LibraryView`
reads them with `useSearchParams` and writes them with `window.history.replaceState`, which
Next keeps in sync with `useSearchParams` without a server round trip, so a filtered view can be
bookmarked or linked (the `/presentations` redirect relies on it). Because of
`useSearchParams`, `app/(dashboard)/polls/page.tsx` wraps the view in `<Suspense>` with a
skeleton fallback (required for the static build).

## Cards and actions

| | Primary | Menu (`…`) |
|---|---|---|
| Poll draft | Edit draft (`/create?draftId=`) | Convert to presentation, Delete |
| Published poll | Analytics, Share (copies `/p/[id]`) | Open voting page, Copy link, Convert to presentation (or Open converted deck + Convert again), Close poll (live only), Delete |
| Deck | Edit (`/presentation/create?id=`), Present / Resume (`/presentation/host/[id]`, no `?reset`) | Copy join link (`/live/[code]`), Share with team… (team workspaces, editor and above: opens the ShareDialog, see `workspaces.md`), Delete |

Statuses: polls Draft / Active / Closed; decks Draft / Lobby open / Live / Ended. Badges show
"Assessment" for TRIAL polls, "Self-paced deck" for audience-paced decks and "From poll" /
"From quiz" for converted or migrated decks.

**Convert to presentation** calls `POST /api/library/convert/poll/:id` (`?force=true` for
"Convert again"), then opens the new deck in the builder. A second plain convert returns the
deck made earlier. Responses are never copied; the poll keeps working at `/p/[id]`.

The "Live now" stat is the backend's `counts.live`: published, open polls plus decks in
`lobby` or `active` (the old dashboard derived it from a stale status list).
