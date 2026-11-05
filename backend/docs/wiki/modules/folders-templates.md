---
summary: Library folders (/api/folders, filing decks and polls, folder shares), templates (/api/templates, starter decks, save as template, use), co-editing revisions (If-Match, slide-level routes) and builder presence — package W3-B2.
status: active
last_updated: 2026-11-05
---

# Folders, templates and co-editing (W3-B2)

Duplicate (`POST /api/presentations/:id/duplicate`, `POST /api/polls/:id/duplicate`) predates this
package: `modules/library.md` → Duplicate. Share semantics: `platform/tenancy.md`.

## Folders (`src/modules/folders/`)

| File | Role |
| --- | --- |
| `folder.model.ts` | `Folder` (collection `folders`): `workspaceId, parentId (always null), name (≤60), nameKey (trimmed, lowercased), createdBy, deletedAt (unused, kept for the sharing module's raw read)`. Unique index `folder_name_per_parent` `{workspaceId, parentId, nameKey}`. At most 200 per workspace. |
| `folders.schema.ts` | Strict Zod bodies: `{name}` (trimmed, 1–60), move `{folderId: id \| null, items: [{entityType: 'presentation' \| 'poll', id}] (1–100)}`. |
| `folders.service.ts` | `FoldersService.list / create / rename / remove / move`. |
| `folders.controller.ts`, `folders.route.ts` | Mounted at `/api/folders`; every route `authenticate()` → `workspaceContext()`; writes 120/min/user. |

| Method + path | Policy | Result |
| --- | --- | --- |
| `GET /` | `deck:read` (any member) | `{ folders: FolderView[] }`, sorted by name |
| `POST /` `{name}` | `deck:create` | 201 `{ folder }`; `409 FOLDER_NAME_TAKEN` (case-insensitive, per workspace); `409 FOLDER_LIMIT_REACHED` |
| `PATCH /:id` `{name}` | `deck:edit` on the folder (an editor share on it counts) | `{ folder }`; `409 FOLDER_NAME_TAKEN` |
| `DELETE /:id` | `deck:delete` (workspace role; shares never grant it) | `{ folder: {id, name}, moved: {presentations, polls}, sharesRemoved }` |
| `POST /move` | `deck:edit` on the target folder, `deck:share` on every item | `{ folderId, moved: {presentations, polls} }` |

```ts
FolderView = { id, name, parentId: null, counts: { presentations, polls }, createdAt, updatedAt }
```

- **One level.** `parentId` is stored (always null) so nesting can come later without touching
  documents; the policy matches only a deck's direct folder.
- **Counts** are what the library lists in the folder: decks not in the trash and not templates,
  and polls.
- **Moving** is all or nothing: every item must exist (decks: not trashed, not templates) in the
  caller's workspace, else 404 and nothing moves. Items from before workspaces are `409 NOT_MOVABLE`.
  It needs `deck:share` (editor and up, never through a share) because a folder's shares cover the
  decks in it: filing a deck into a shared folder, or taking it out, changes who can open it.
  Moving does not touch `updatedAt` (the library order stays). A delete of the target folder racing
  the move puts the items back at the top level and answers 404.
- **Deleting** a folder deletes the document, sets `folderId: null` on its decks (trashed ones too)
  and polls, and **deletes its `ResourceShare` rows** (`resourceType: 'folder'`), as
  `modules/members-sharing.md` requires. Nothing else is deleted.
- **Sharing** a folder uses `GET|PUT /api/shares?resourceType=folder&resourceId=` (W3-B1, which
  reads the raw `folders` collection). A share on a folder covers its decks; polls have no shares.
- Copies keep the folder: a duplicated deck or poll lands in the source's folder (same workspace).
- `Poll.folderId` (default null) is new; `Presentation.folderId` existed. The library filters on
  both (`GET /api/library?folderId=<id>|root`) and every card carries `folderId`.
- A workspace purge (`privacy.purge.ts`) deletes its folders.
- Audit: `folder.create` (`meta {name}`), `folder.rename` (`{from, to}`), `folder.delete`
  (`{name, moved, sharesRemoved}`), `folder.move` (target folder or none; `{folderId, moved}`).

## Templates (`src/modules/templates/`)

| File | Role |
| --- | --- |
| `seeds.ts` | `SEED_TEMPLATES`: four starter decks as create bodies, ids are stable slugs: `team-retro` (Meetings), `conference-talk` (Events, Q&A and reactions on), `classroom-quiz` (Education, scored, two leaderboards), `all-hands-pulse` (Company, anonymous, moderated Q&A). |
| `templates.service.ts` | `TemplatesService.list / saveAsTemplate / use / remove`. Seeds are parsed with `createPresentationSchema` on first use (memoized). |
| `templates.schema.ts`, `templates.controller.ts`, `templates.route.ts` | Mounted at `/api/templates`; `authenticate()` → (copy routes: 30/min/user) → `workspaceContext()`. |

| Method + path | Policy | Result |
| --- | --- | --- |
| `GET /` | `deck:read` | `{ starter: TemplateSummary[], workspace: TemplateSummary[] }` (workspace: ≤100, newest first) |
| `POST /` `{presentationId, title?}` | `deck:read` on the deck (shares count) + `deck:create` | 201, the template (a deck document); `409 ALREADY_A_TEMPLATE` |
| `POST /:id/use` `{title?}` | `deck:create` (+ `deck:read` on a workspace template) | 201, the new draft deck; unknown id → `404 TEMPLATE_NOT_FOUND` |
| `DELETE /:id` | `deck:delete` on the template | `{ id, title }`; a non-template id → 404 |

```ts
TemplateSummary = { id, source: 'starter' | 'workspace', title, description, category, slideCount,
  slideTypes /* ≤6 distinct */, outline /* first 6 slide labels */, pace, createdBy: {id,name} | null, updatedAt | null }
```

- **Workspace templates are decks** with `isTemplate: true` and `templateSourceId` = the deck they
  were saved from (`crud.copyDeckForWorkspace`: slides with new ids, pace, settings, theme; no
  folder, sessions or answers). They never appear in `GET /api/library` (and its counts) or
  `GET /api/presentations`.
- **Never presented**: `POST /:id/host/open-lobby` and `/host/start` on a template are
  `409 TEMPLATE_NOT_PRESENTABLE` (`live/session.service.ts` `assertPresentable`), so no session can
  ever exist for one (MCP host tools go through the same code). `GET /:id` and `GET /:id/host/state`
  still answer (with `isTemplate: true`): the builder and the host console use it to show "This is a
  template" with **Use template** instead of editing or presenting it.
- **Use** creates an ordinary draft deck in the caller's workspace: from a starter through
  `createPresentation` (the workspace's default theme applies), from a workspace template through
  `copyDeckForWorkspace` with `templateSourceId` = the template. Title: the body's, else the
  template's.
- Starter decks live in code: a deploy updates them for everyone. `tests/templates.seeds.test.ts`
  parses each with the create schema, so a broken seed fails CI, not a user.
- Audit: `template.create` (`meta {sourceId, title}`), `template.use` (`{templateId, title}`),
  `template.delete`.

## Co-editing (`presentations/revision.ts`, `crud.service.ts`)

- **`Presentation.revision`** (Number, default 0; older decks read 0) is +1 on every save that
  changes the title or the slides: `PATCH /:id` with `slides` or a different `title`, and every
  slide-level route. Theme, settings and pace saves do not change it (they patch fields, no
  read-modify-write of the slides), so the builder's Theme and Audience tabs never make its own
  next save stale. It is in every deck response body (not an ETag header: Express's body ETag
  keeps GET revalidation right when only the theme changes).
- **`If-Match: "<revision>"`** (also `<revision>` or `W/"<revision>"`; `*`/empty = no check;
  anything else `400 INVALID_IF_MATCH`) on `PATCH /:id` and the slide routes: a stale revision →
  **`409 DECK_CHANGED`** with `details: { revision }` (the current one). Without `If-Match` writes
  behave as before (last write wins), for MCP and older clients. Saves stay compare-and-set on
  `__v` (optimisticConcurrency), so two writers that read the same revision cannot both win.
  MCP keeps its own `expectedVersion` (`__v`) check.
- **Slide ids survive saves.** `PATCH /:id` slides may carry `_id`
  (`editableSlideSchema`): a slide naming one of the deck's slide ids keeps it; unknown and
  repeated ids get new ones. Create and other callers never see `_id`. (Before, every save gave
  every slide a new id.)

Slide-level routes (`/api/presentations/:id/...`, `deck:edit`, draft or ended decks only, each
answers with the whole deck):

| Method + path | Body | Notes |
| --- | --- | --- |
| `POST /slides` | `{ slide, index? }` | 201; `data.slideId` is the new slide's id; ≤50 slides (`400 TOO_MANY_SLIDES`) |
| `PATCH /slides/:slideId` | the fields to change | merged onto the stored slide and validated by its type (a `type` change too); `_id`/`kind` ignored; `404 SLIDE_NOT_FOUND` |
| `DELETE /slides/:slideId` | – | `400 LAST_SLIDE` for the only slide |
| `POST /slides/reorder` | `{ order: slideId[] }` | every slide id once; a set that differs from the deck's → `409 DECK_CHANGED` |

Without `If-Match` a slide edit that loses a race with another save is re-applied on the fresh
deck (up to 3 attempts): it only touches the slide it names, so concurrent edits of different
slides all survive. Uploaded media in a new or patched slide must belong to the deck's workspace.

## Presence (`presentations/editor.socket.ts`)

`deck:join` / `deck:leave` / `presence:update`: who else has the deck open in the builder, for
editors only (`deck:edit`), one entry per user with their number of open builders. Socket contract,
Redis hash and channel: [`../realtime/editor.md`](../realtime/editor.md).

## Migration 210

`src/migrations/210-folders.ts`: `FolderModel.syncIndexes()` (new collection) and
`polls_workspace_folder_updated` `{workspaceId, folderId, updatedAt:-1}` on `polls` (createIndex).
Idempotent; no backfill (a missing `folderId` reads as null).

## Tests

- `tests/templates.seeds.test.ts` — every starter deck parses; If-Match parsing; editable slide
  ids; slide patch/reorder and folder schemas.
- `tests/integration/folders.test.ts` — folder CRUD, names, counts, filing and the library filter
  (and the pre-workspace item rule),
  copies keeping the folder, all-or-nothing moves, roles, folder shares and their removal with the
  folder, the workspace boundary, migration 210; templates: starters, use, save as template (hidden
  from the library), delete, roles, workspace boundary, `TEMPLATE_NOT_PRESENTABLE` on open-lobby and start.
- `tests/integration/coediting.test.ts` — revisions, 409 on stale `If-Match` (whole deck and every
  slide route), theme/settings saves not bumping it, slide ids kept, slide routes, concurrent slide
  edits without `If-Match`, errors, viewers, other workspaces, live decks.
- `tests/integration/tenancy-isolation.test.ts` — the matrix includes the folder, template, folder
  share and slide routes.
- `tests/integration/presence.test.ts` — presence joins, updates on open and leave, tabs, refusals,
  stale entries.
