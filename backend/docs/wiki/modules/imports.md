---
summary: Importing decks and questions - PPTX, PDF and Google Slides as queued jobs, CSV/XLSX question files synchronously; mapping tables, limits, queue and worker topology, security guards and owner setup.
status: active
last_updated: 2026-10-19
---

# Imports Module (`src/modules/imports/`, `src/workers/import.worker.ts`)

Bring existing material into OpenPoll as a new deck (or, for questions, into an open one).

| Source | How | Result |
| --- | --- | --- |
| `.pptx` (upload) | queued job | editable `heading` / `bullets` / `paragraph` / `image` slides, speaker notes |
| `.pdf` (upload) | queued job | one `image` slide per page, page text in notes and alt text |
| Google Slides link | queued job | the deck's PPTX export, then the PPTX path |
| Google Drive file | queued job, only with Drive import configured | same, through the Drive API |
| `.csv` / `.xlsx` questions | `POST /api/imports/questions`, synchronous | validated question slides appended to a deck or a new deck |

Uploads use the existing presign flow (`purpose: "import_source"`, `platform/storage.md`); the
import never receives file bytes over the API.

## API (mounted at `/api/imports`)

All routes except the templates need `authenticate()`; creating things also needs
`workspaceContext()` and the `deck:create` / `deck:edit` policy.

| Route | Limits | Notes |
| --- | --- | --- |
| `POST /` | 10/min per user | Body below. `202` with the job. Counts one `import` from the plan's `importsPerMonth` (403 `PLAN_LIMIT_REACHED`). |
| `GET /:id` | 240/min per user | The job's creator only, and only while an active member of its workspace; anyone else (and bad ids) gets 404. |
| `POST /questions` | 20/min per user | `multipart/form-data`, file ≤ 2 MB. See below. |
| `GET /templates/questions.csv`, `.xlsx` | 30/min per IP | Public, cacheable. |

**`POST /api/imports`**

```jsonc
{ "kind": "pptx" | "pdf", "key": "<storage key from /api/uploads/complete>", "title"?: "…" }
{ "kind": "gslides", "url": "https://docs.google.com/presentation/d/<id>/edit", "title"?: "…" }
{ "kind": "gslides", "driveFileId": "<id>", "driveAccessToken": "<picker token>", "title"?: "…" }
```

- `pptx`/`pdf`: 503 `STORAGE_DISABLED` while storage is off; 404 `UPLOAD_NOT_FOUND` when the key is not an
  `import_source` MediaAsset of this workspace; 400 `IMPORT_KIND_MISMATCH` when the upload is the other
  type. Google links need no storage (pictures are then skipped with a warning).
- `gslides` with a link: 400 `INVALID_LINK` unless it is a `https://docs.google.com/presentation/d/<id>` address.
  With `driveFileId` + `driveAccessToken`: 503 `GOOGLE_DRIVE_DISABLED` unless Drive import is configured
  (`capabilities.googleDriveImport`). The token is kept in Redis for at most an hour (encrypted with
  `ENCRYPTION_KEY` when set) and deleted when the job ends.
- Repeating the request for a source whose job is still `queued`/`running` returns that job and counts nothing.

**Usage counting (`importsPerMonth`, counter `import`).** An import is counted **once, when its job is created**
(`consumeUsage(workspace, 'import')` after the request is validated and before the job is queued; over the limit
→ 403 `PLAN_LIMIT_REACHED` and nothing is created). Everything that happens to a job afterwards never counts again:
worker attempts, retries after a transient failure, reaper requeues, a repeated `POST` for a source whose job is still
queued or running (it returns that job). A job that ends `failed` stays counted (the work was accepted and capacity
spent); starting the same file again is a new import and counts as one. The question import counts once when it
writes (`mode=import`); `preview` is free.

**Job** (`GET`/`POST` response `data`): `{ id, kind, status: 'queued'|'running'|'completed'|'failed', stage, title,
warnings: [{code, message, slide}], error: {code, message} | null, resultPresentationId, createdAt, startedAt,
finishedAt }`. `error.message` is written for the person who started the import. `resultPresentationId` is
reserved when the job is first claimed, so it is also set on a failed job (the deck does not exist then).

**`POST /api/imports/questions`**: fields `file` (CSV or XLSX, judged by content), `mode` (`import`, default,
or `preview`), `presentationId` (append to this deck; else a new deck is created) and `title`.
`preview` parses and reports without writing or counting usage, and returns the parsed `slides` too (the builder adds
them to the deck it has open). `import` creates/extends the deck, counts one
import and records a completed `ImportJob` (`kind: csv|xlsx`). Response `data`: `{ mode, fileKind, totalRows,
imported, skipped, capacity, questions: [{row, type, question, detail}], errors: [{row, column, message}],
warnings }` plus, for `import`, `{ importId, presentationId, created, slideCount }`. Rows with problems are skipped
and listed (rows are numbered as a spreadsheet shows them, the header being row 1); the valid ones are imported.
Errors: 400 `NO_VALID_QUESTIONS` (with `details.errors`), `QUESTIONS_HEADER_INVALID`, `QUESTIONS_UNREADABLE`,
`QUESTIONS_TOO_MANY_ROWS`; 413 `UPLOAD_TOO_LARGE`; 415 when not multipart; 403 without `deck:edit` on the deck
(or `deck:create`); 400 for a deck that is being presented.

## Question file format

One question per row; the first row is the header (`type` and `question` required). Download the templates
(they import cleanly): `GET /api/imports/templates/questions.csv|xlsx`. Header names are case-insensitive and a
few aliases work (`question text`, `option1`, `correct answer`, `time`, …); unknown or repeated columns are ignored
with a warning.

| Type (aliases) | Columns | Rules |
| --- | --- | --- |
| `select_answer` (multiple choice, poll, quiz) | `option_1`..`option_8`, `correct`, `points`, `time_limit`, `explanation` | 2–8 options, no gaps. `correct`: option numbers (`2`, `1,3`) or option text; more than one correct → "pick all". Empty `correct` → survey question (0 points); `points` > 0 without `correct` is an error. Default 1000 points, 30 s. |
| `type_answer` | `accepted_answers` (`|`-separated), `points`, `time_limit` | At least one accepted answer. |
| `wordcloud` | `max_entries` (1–3) | Untimed unless `time_limit`. |
| `open_ended` | – | Untimed unless `time_limit`. |
| `scales` | `statements` (`|`-separated, 1–10), `min_label`, `max_label`, `scale_max` (2–10) | |
| `ranking` | `items` (`|`-separated, 2–10) | |
| all | `notes` (speaker notes), `time_limit` (0 or 5–300) | |

Each row is built into a request-shaped slide and validated by the slide registry's own schema
(`presentationSlideSchema`), so an imported question obeys exactly the builder's rules.

Parsing is injection-safe: cells are text only (a formula cell yields its cached result, never the formula);
headers are looked up in `Map`s (no prototype keys); control characters are stripped; cells are cut at 5000
characters; the templates escape formula-looking cells. CSV: UTF-8 (BOM), UTF-16 or Windows-1252, delimiter
detected (`,` `;` tab `|`). XLSX: the first sheet with data; the archive passes the zip guard and is repacked before
exceljs reads it. Limits: 2 MB, 1000 scanned rows, 60 columns, a deck's 50 slides (rows beyond the deck's free
room are reported as skipped).

## Worker and queue

State lives in Mongo (`ImportJob`: `workspaceId, userId, kind, status, sourceKey, sourceRef, viaDrive, title,
resultPresentationId, warnings[], error, stage, attempts, leaseOwner, heartbeatAt, queuedAt, startedAt,
finishedAt`; migration `150-import-jobs`). Redis only says who runs what (keys share the `{imports}` hash tag,
`modules/imports/queue.ts`):

- `pending` list: `POST` does `LPUSH`; a consumer does `BLMOVE pending processing RIGHT LEFT` (oldest first).
- `processing` list + `lease:<id>` (`SET … PX visibilityMs`): the worker leases the job and renews it every
  third of the visibility timeout (120 s) while it works.
- **Reaper** (`ImportWorker.reapOnce`, every 30 s, one pass at a time across instances through a short Redis lock):
  an id in `processing` without a lease for the grace period (30 s) is taken back; a job already claimed
  `maxAttempts` (3) times is failed with `IMPORT_INTERRUPTED` instead. It also re-queues jobs Mongo says are
  unfinished but Redis lost (flushed or restored Redis), and drops ids of finished jobs.
- A failure the user can fix (`ImportError`, a 4xx `ApiError`) fails the job at once; anything else is retried up to
  3 times and then fails with `IMPORT_FAILED` ("a problem on our side").
- A retry after a crash never creates a second deck: the deck id is reserved on the job at the first claim, the
  deck is created with that id, and a repeated run that finds the deck finishes immediately. Stored pictures use keys
  derived from the job, so a retry overwrites them.

**Topology.** `IMPORT_WORKER_INPROCESS` (default **on**, in every environment; `0`/`false`/`off` disables) starts the
consumers inside the API process (`startJobs()`). Parsing and rendering are CPU heavy, so for production run
`IMPORT_WORKER_INPROCESS=0` on the API instances and `bun run worker:import` (`src/workers/import.worker.ts`;
needs the same `MONGO_URI`, `REDIS_URL`, `S3_*`, `GOTENBERG_URL`, `ENCRYPTION_KEY`) on one or more worker instances.
`IMPORT_WORKER_CONCURRENCY` (default 1, max 4) sets jobs per process. Tests start `new ImportWorker({...})`
themselves; the harness never starts jobs.

## PPTX (`pptx/parse.ts`, `pptx/map.ts`)

Slides are read in the order of `ppt/presentation.xml` `sldIdLst` through the package relationships (never by part
name). Text blocks keep their placeholder role (`title`, `ctrTitle`, `subTitle`, body, free text), paragraph level
(`a:pPr@lvl`) and bullet marks (`buChar`, `buAutoNum`, `buNone`); tables become text lines; `mc:AlternateContent`
reads its fallback; footers, dates and slide numbers are dropped.

| PowerPoint slide | OpenPoll |
| --- | --- |
| title (+ subtitle), nothing else | `heading` (a lone subtitle becomes the heading) |
| title + leveled or bulleted body (or ≥ 2 unmarked paragraphs in a body placeholder) | `bullets`; level N gets `"– "` repeated N times; > 10 bullets split over slides "Title (1/2)" |
| title + other text | `paragraph` (paragraphs joined by blank lines) |
| table | `bullets`, one item per row (`TABLE_CONVERTED`) |
| picture covering ≥ 40 % of the slide (or the only thing on it) | `image`: picture stored as MediaAsset (`source: 'import'`), alt = the picture's description, else the slide text; title → caption; other pictures on the slide are skipped (`PICTURES_SKIPPED`) |
| picture next to text | text slide, `PICTURES_SKIPPED` |
| notes slide body | `notes` (≤ 5000) |
| chart, SmartArt, OLE object, video, audio, ink, EMF/WMF or linked picture | warning (`CHART_NOT_IMPORTED`, …); the text on the slide stays. With `GOTENBERG_URL`: the whole slide becomes an `image` slide of its rendered page (`SLIDE_RENDERED`), notes kept |
| hidden slide, empty slide, a slide holding only unsupported content (no renderer) | skipped, with a warning |
| more than 50 slides | the first 50 (`SLIDES_LIMIT`) |

Pictures: PNG, JPEG, GIF, WebP, AVIF are stored as they are (judged by content); BMP and SVG are re-encoded as PNG
by the canvas (an SVG is rasterised, never stored); anything else, or over 20 MB, is skipped with a warning
(`IMAGE_FORMAT_UNSUPPORTED`, `IMAGE_TOO_LARGE`). Without storage (Google links only) pictures stay placeholders
and one `PICTURES_NOT_STORED` warning says so. Long text is cut to the slide field limits with a warning.
The deck title is the document title (not a program default such as "PowerPoint Presentation"), else the first slide
title, else "Imported presentation" (a `title` in the request wins). Slides past the 50th are not rendered or stored.

**Rendered fallback (`renderers/gotenberg.ts`).** `POST {GOTENBERG_URL}/forms/libreoffice/convert` with the PPTX; the
returned PDF is rendered like any PDF. LibreOffice leaves hidden slides out of the PDF, so pages are matched to
visible slides (or to all slides when the page count says it kept them). When Gotenberg is down or the count does
not match, the import continues without it and adds `RENDER_UNAVAILABLE`.

## PDF (`pdf/render.ts`)

unpdf (pdf.js) opens the file once; each page (≤ 50) renders to PNG through `@napi-rs/canvas` at 2× scale, lowered
so neither side exceeds 1920 px, is stored, and becomes an `image` slide whose alt text is the page's text (≤ 500
characters, else "Page N") and whose notes hold the full page text. The deck title is the PDF's Title property, else
the first text line, else "Imported PDF". Password-protected files fail with `PDF_ENCRYPTED`, damaged ones with
`INVALID_PDF`; a page that cannot render (implausible size, 30 s timeout) is skipped with `PAGE_SKIPPED`; pdf.js runs
with `isEvalSupported: false` and an image-size cap.

## Google Slides (`gslides.ts`, `ssrf.ts`)

A public link (`Anyone with the link`) is fetched as `https://docs.google.com/presentation/d/<id>/export/pptx`.
A private file answers with a login redirect, a 401/403/404 or an HTML page and fails with `GSLIDES_PRIVATE` ("share
it as Anyone with the link"). The fetch goes through the SSRF guard: https only, no credentials, port 443, host
allow-list (`docs.google.com`, and Google's signed download hosts `doc-*.googleusercontent.com` that the export
redirects to; for Drive, `www.googleapis.com`), redirects followed by hand (≤ 3) with every hop re-checked,
every address the host resolves to must be public (loopback, private, link-local, CGNAT and metadata ranges are
refused), 60 s timeout and a 100 MB streaming size cap. Drive imports export a native Slides file
(`/drive/v3/files/<id>/export`, limited by Google to 10 MB of exported content) or download an uploaded `.pptx`
(`?alt=media`) with the picker's bearer token.

## Limits and guards (`limits.ts`, `zip.ts`, `xml.ts`)

| Limit | Value |
| --- | --- |
| Source file (`import_source` upload) | 100 MB |
| Slides per deck | 50 |
| ZIP entries / declared total / one entry / ratio (entries > 1 MB) | 5000 / 400 MB / 100 MB / 100× |
| One XML part | 20 MB |
| Picture in a PPTX | 20 MB; pixels when converting: 40 MP |
| PDF pages / render size / page size | 50 / 1920 px / 14400 pt |
| Question file / rows scanned / XLSX uncompressed | 2 MB / 1000 / 50 MB |
| Google export download / time | 100 MB / 60 s |
| Gotenberg response / time | 200 MB / 120 s |

`SafeZip` reads the central directory only (entry count, declared sizes, ratio, names with `..`, backslashes,
absolute or drive paths, duplicates, encryption, zip64 all refused with `ARCHIVE_REJECTED`) and then inflates each
entry in 16 KB slices into a buffer of its declared size, stopping the moment it would exceed it: an entry that lies
about its size cannot cost more than its declared size. XML goes through fast-xml-parser with entity processing off;
any `DOCTYPE`/`ENTITY` declaration is refused (OOXML never has one) and the predefined entities and numeric
references are decoded by hand. Relationship targets are resolved inside the package and ignored when they escape it.

## Capabilities and owner setup

`GET /api/capabilities`: `storage` (PPTX/PDF imports and stored pictures), `pptxHighFidelity` (= `GOTENBERG_URL`
set), `googleDriveImport` (= `GOOGLE_DRIVE_IMPORT_ENABLED=true` with `GOOGLE_DRIVE_API_KEY`, `GOOGLE_DRIVE_APP_ID`
and Google OAuth). Each is off by default and the corresponding feature answers a clear error rather than faking
success. The owner sets up:

1. **Bucket** (required for PPTX/PDF): `S3_*` as in `platform/storage.md`; CORS allowing `PUT` from the frontend origin.
2. **Gotenberg** (optional): run `gotenberg/gotenberg:8` next to the backend and set `GOTENBERG_URL`.
3. **Google Cloud** (optional, private Drive files): a project with the Drive and Picker APIs enabled, an OAuth client
   (`GOOGLE_CLIENT_ID/SECRET`), a browser API key for the Picker (`GOOGLE_DRIVE_API_KEY`) and the numeric project
   number (`GOOGLE_DRIVE_APP_ID`); then `GOOGLE_DRIVE_IMPORT_ENABLED=true`. The frontend Picker is not built yet:
   until it is, `POST /api/imports` with `driveFileId`/`driveAccessToken` is the contract a Picker would call.
4. **Worker** topology (see above) and, for isolation, a worker instance.

## Tests

- Unit: `tests/imports.pptx.test.ts` (parser, zip/XML guards, mapping), `imports.pdf.test.ts`,
  `imports.questions.test.ts` (columns, CSV/XLSX, templates), `imports.gslides.test.ts` (link parsing, SSRF guard,
  Drive, Gotenberg client), `imports.media.test.ts`. Generated fixtures: `tests/fixtures/imports/{pptx,pdf,questions}.ts`
  (PPTX built with fflate, PDFs with pdfkit, CSV/XLSX with good and bad rows, a zip bomb, a traversal archive).
- Integration: `tests/integration/imports.test.ts` (job lifecycle through the in-process worker, retries, reaper,
  Redis loss, authorization and workspace isolation, storage off, plan limit, rate limit, questions import).
