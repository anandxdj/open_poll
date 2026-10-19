---
summary: Live presentation decks (Mentimeter-style) — slide type registry, sessions (one per run), scored and interactive slides, join codes, speed scoring, leaderboard, Redis-first hot path.
status: active
last_updated: 2026-10-19
---

# Presentations Module (`src/modules/presentations/`)

`modules/presentations` runs presenter-paced live decks. The host drives a slide deck;
participants join with a 6-digit code or QR scan and a nickname (no account), answer
timed slides on their phone, and earn points on scored slides. Leaderboard slides show
standings mid-deck; final standings show on `end`.

This is the only live-deck module. It replaced `modules/quizzes`, which was unmounted in
`5e63f87` and deleted afterwards; the "quiz" names that survive (`/api/quizzes`,
`quiz:*` socket events, `POST /api/ai/generate-quiz`) are wire compatibility, not a
second entity. Graded polls ("assessments", `pollType: 'TRIAL'`) are a different
feature in `modules/polls` — see `modules/polls.md`.

> Roadmap for upcoming phases: `backend/docs/wiki/quiz-roadmap.md` and
> `docs/planning/04-implementation-plan.md`. Live session contract (sessions, slide phases,
> host/participant API, events, keys): [`presentations-live.md`](./presentations-live.md).

## Module layout

| Path | Owns |
|---|---|
| `presentations.service.ts` | **Facade** (`PresentationService` + `publishPresentationEvent`, `computeSlideDistributionHelper`). The stable API for the socket, MCP, AI, worker and controllers; delegates only. Methods take an `actor`: the request (policy context) or a bare user id (sockets, scripts, tests). |
| `access.ts` | `getPresentationById` (404 for trashed decks), `authorizeDeck(id, actor, action)` (`assertCan`), `canActOnDeck` (socket yes/no), `actorContext` (a bare user id resolves its membership in the deck's workspace). |
| `crud.service.ts` | Create (in the request's workspace), workspace-scoped list, update (settings/theme patched field by field), delete (with sessions and their Redis keys). |
| `live/session.service.ts` | The session engine: `openLobby`, `startSession`, `gotoSlide`/`advanceSlide`, `closeCurrentSlide`, `reopenCurrentSlide`, `revealCurrentSlide`, `endPresentation`, `getHostState`, `listSessions`, `getPresentationByCode`. Only writer of the deck mirror. |
| `live/state.ts` | Slide states and phases, the Redis **answer windows** (`loadAnswerWindow`, rebuilt from the session document on a miss), live-session lookup, `StoredAnswerResult`. |
| `live/answer.service.ts` | `submitAnswer` hot path: window lookup, registry `accept`/`score` in JS, then ONE Redis script call; replays by `clientAnswerId`; metrics. |
| `live/answerScript.ts`, `live/lua/answer.lua` | The answer script: window/grace, auth, rate limit, dedup, the type's ops (run generically), scores, stored result, coalescer mark. KEYS/ARGV builders and `EVALSHA` runner. |
| `live/writeBehind.ts` | Batched Mongo write-behind of accepted answers (50 ms / 200 answers); participant totals unless final. |
| `live/coalescer.ts` | One host `answer:received` per dirty slide per 250 ms window, exactly once across instances. |
| `live/ticket.ts` | Slide tickets (HMAC) that stretch the timer grace. |
| `live/autoReveal.ts`, `live/autoRevealWorker.ts` | Schedule (`live:autoreveal` ZSET) and poller of the 1.5 s auto-reveal of scored timed slides. |
| `live/participant.service.ts` | `joinPresentation` (audience cap), `verifyParticipant`, `isAuthorizedParticipant`, `getParticipantState` (`/me`), `getParticipantLiveState` (`/live-state`). |
| `live/distribution.ts` | `computeSlideDistributionHelper` (registry `distribution`), `replayDistribution` (from stored answers), `getLeaderboard`, `getStoredLeaderboard`, `getParticipantCount`. |
| `live/snapshot.ts` | End-of-session reconciliation (Redis results → missing Mongo answers, participant totals) and the snapshot (`slideStats`, `finalLeaderboard`, counts). |
| `live/views.ts` | `SessionView`, `SlideStateView`, `SessionListItem` builders. |
| `live/contract.ts` | Wire types of the live contract (responses, event payloads, error codes). |
| `live/keys.ts` | Session-scoped Redis key map, logical slide targets → keys, TTLs. |
| `live/events.ts` | One publish function per live event (with `sessionId`); all go through `publishPresentationEvent` → `publishLiveEvent`. |
| `slides/` | Slide type registry (below). |
| `models/{presentation,session,participant,answer}.model.ts` | Mongoose models; `presentations.model.ts` is the barrel to import from. |
| `presentations.schema.ts` | Request schemas; the slide schema dispatches to the registry. |
| `routes/{participant,crud,host}.route.ts` | Sub-routers composed (in that match order) by `presentations.route.ts`. |
| `controllers/{participant,crud,host}.controller.ts` | Thin HTTP handlers calling the facade. |
| `presentations.socket.ts` | Socket handlers: joins, `answer:submit` (acked), `live:resync` (see `realtime/presentations.md`). |

## Slide type registry (`slides/`)

Every slide type is one `SlideTypeDef` (`slides/types.ts`) in `slides/types/<type>.ts`; the
file calls `registerSlideType` and `slides/index.ts` imports it (one line per type,
alphabetical; content types go under `slides/types/content/`). The engine, request schema,
Mongoose model and worker look the type up instead of switching on `slide.type`.

| Field | Meaning |
|---|---|
| `type`, `name` | Registry key (stored as `slide.type`) and human name ("Select answer"; used in messages like "Leaderboard slides have nothing to reveal" and export headers). |
| `kind` | `content` \| `interactive` \| `system` — copied onto the slide as `kind`. |
| `lifecycle` | What `advance` does: `response` opens a timed answer window (`question:started`); `content` and `board` publish `slide:shown` with the sanitized slide, no timer, answers rejected; `system` publishes `leaderboard:shown`. Only `response` slides can be revealed. |
| `scored` | Feeds the leaderboard; `score` is called only for scored types. |
| `isScored?(slide)` | Per-slide opt-out for scored types (`isSlideScored(slide)` combines both). `select_answer` and `type_answer` slides worth 0 points or without a correct answer are ungraded: no points, never correct, no correct answer in the distribution, `scored: false` on the participant slide, the window and the stored result. |
| `schema` | Zod schema for one slide of this type in create/update requests (defaults included). |
| `sanitize(slide)` | **Explicit allow-list** of participant-facing fields. The registry's `toParticipantSlide` adds `slideIndex`, `totalSlides`, `type`, `kind`, `scored`, `media` (`{url, alt, layout}`, never `key`) and `layout`. Notes and answer keys never leave the server because nothing copies them. |
| `acceptConfig?(slide)` | JSON snapshot cached in the answer window (answer keys, counts, points, `timeLimitMs`). |
| `answerSchema?` | Zod check of the answer payload's structure; config-dependent checks live in `accept`. |
| `accept?(cfg, payload, {elapsedMs})` | Grades one answer → `{isCorrect, ops, persist}`. Throws `ApiError.badRequest` to reject; nothing has been written yet (grading runs before the answer script). |
| `score?(cfg, {isCorrect, elapsedMs})` | Points for scored types (`speedScore` in `slides/ops.ts`). |
| `distribution?(slide, {dist, disp, feed})` | Results payload for reveal, host state and the coalesced host update. |
| `feedLength?` | Capacity of the per-slide `feed` list; when set, `distribution` receives it. |
| `exportColumns?(slide)` / `exportCells?(slide, answer)` | Per-participant export columns and cells (for session exports). |
| `label(slide)` | Short label for one slide (question, or the type name). |

`RedisOp` (built with `hincrby`, `hsetnx`, `lpushTrim` from `slides/ops.ts`) targets a logical
per-slide structure — `dist` (HASH), `disp` (HASH), `feed` (LIST) — that `live/keys.ts` maps to
the real key; `lpush_trim` keeps the newest `max` entries. The answer script executes every op
kind generically (JSON in `ARGV`, `dist`/`disp`/`feed` passed as `KEYS`), so a new type that
combines these ops needs no change to the script; a new op KIND needs a branch in `answer.lua`,
its JS port in `tests/presentations/answerScript.fake.ts` and a parity case. `persist` is
`{optionIndex, text, payload}` for the answer document.

Registry API (`slides/registry.ts`): `defineSlideType`, `registerSlideType` (returns a
disposer; duplicate keys throw), `getSlideType`, `requireSlideType` (400 for unknown stored
types), `hasSlideType`, `listSlideTypes`, `isScoredSlideType`, `slideKindOf`,
`toParticipantSlide`. Tests register fixture types and dispose them afterwards.

Built-in types (`kind`/`lifecycle`): `select_answer`, `type_answer` (scored),
`wordcloud`, `open_ended`, `scales`, `ranking` — all `interactive`/`response`;
`leaderboard` — `system`/`system`. They share one flat participant shape
(`builtInParticipantFields`) and one request base (`builtInSlideSchema`, question
required). Scored types keep a 5–300 s timer; unscored ones (`{ untimed: true }`) also
accept `timeLimit: 0` (untimed: open until the host closes or reveals it). The eight content types are below.

### Content slide types (`slides/types/content/`)

`kind: 'content'`, `lifecycle: 'content'` (advancing publishes `slide:shown`, no answer
window, answers and reveal rejected), never scored. The request schema
(`contentSlideSchema(type, content)` in `content/shared.ts`) is the common fields plus a
`content` object; `timeLimit` is always stored as 0 and `question` stays `''`. Unknown
`content` keys are stripped. Text is trimmed and stored as typed: markup in a title is
**text**, the clients never render it as HTML.

| Type | `content` (request) | Rules |
| --- | --- | --- |
| `heading` | `{title, subtitle}` | title 1–150, subtitle ≤300 |
| `paragraph` | `{title?, body}` | body 1–2000, markdown-lite (`**bold**`, `*italic*`/`_italic_`, `[text](url)`); link targets must be `https:`, `http:` or `mailto:` |
| `bullets` | `{title?, items}` | 1–10 items, each 1–200 |
| `image` | `{key\|url, alt, fit, caption}` | `alt` required (≤500); `url` must be `https://` (no credentials); `fit` `contain`\|`cover`; caption ≤300 |
| `big_number` | `{value, label, prefix, suffix}` | `value` a finite number, \|value\| ≤ 1e15; prefix/suffix ≤12 |
| `quote` | `{text, attribution}` | text 1–500, attribution ≤150 |
| `video` | `{provider, id\|key, start}` | `youtube` id `^[A-Za-z0-9_-]{11}$`, `vimeo` id `^[1-9][0-9]{5,11}$`, `file` → `key` of an mp4/webm upload; `start` 0–86400 s; fields of other providers are dropped |
| `instructions` | `{showQr, showCode, text}` | both flags default true, text ≤300 |

**Media (`content/media.ts`).** An image (or `file` video) points at an upload by storage
`key`; the schema then pins `url` to `storage.publicUrl(key)`, whatever URL the client sent.
Keys must be well-formed storage keys with an image (png/jpg/jpeg/gif/webp/avif) or video
(mp4/webm) extension, and are refused while storage is off ("File uploads are not configured
on this server; use a link instead"). An image or video with neither source is a placeholder
(builder drafts, outlines); the builder requires a source for an explicit save.
`assertContentMediaInWorkspace(slides, workspaceId)` (async) checks that every key is a
`MediaAsset` of the deck's workspace with a matching `image/*` / `video/*` type (one query),
else 400 `MEDIA_NOT_FOUND` (`STORAGE_DISABLED` when storage is off). The request schema is
synchronous and cannot query, so deck create/update must await it with the deck's workspace
once the schema ran.

**Participant payload.** `sanitize` returns `{content: {…}}` with only the fields above, read
defensively from the stored Mixed value: never `key`, `notes` or unknown keys. Images and
`file` videos carry `url` (resolved from the key against the current storage base URL, else
the stored URL); videos re-check the stored id on the way out (`id: null` when malformed) and
clamp `start`. Labels come from the content (heading title, paragraph title or body start,
first bullet, caption/alt, `prefix+value+suffix label`, quote text, "YouTube video",
instructions text or "How to join").

## Models (`presentations.model.ts` barrel)

- **Presentation** — the deck definition, its settings, and a mirror of its live session.
  - `slides[]` subdocument: `type` (validated against the registry at save time, so types
    registered later validate too), `kind` (derived from the registry on default and on
    every validate; not client-settable), `question` (default `''`; required per type),
    `notes` (≤5000, host only), `media` (`{key, url (http/https), alt, layout}` or null),
    `layout` (string or null), `content` / `config` (Mixed, null by default — for registry
    types without flat fields, validated by the type's `schema`; call `markModified` when
    mutating them in place), `timeLimit` (0–300; 0 = untimed; scored types require ≥5).
    Legacy flat fields of the built-in types stay:
    `options[{text,isCorrect}]` (select, 2–8, at least one correct), `acceptedAnswers[]`
    (type), `maxEntries` 1–3 (wordcloud), `statements[]` + `minLabel`/`maxLabel` +
    `scaleMax` 2–10 (scales), `items[]` 2–10 (ranking), `points` (default 1000),
    `scoreDependsOnTime` (default true). Decks stored before these fields hydrate them
    with defaults (`kind` from the type).
  - Deck fields (all defaulted, so older decks hydrate): `workspaceId` (no default: absent
    until migration 020; the policy then falls back to `creatorId`), `folderId`, `pace`
    (`presenter` | `audience`), `settings` (`audienceLocale`, `nickname`,
    `showResultsOnDevices`, `qna{}`, `reactions{enabled, emojis ≤6}`, `quiz{leaderboard,
    showCorrectOnDevices}`, `audiencePaced{resultsVisibility, assessment{}}`, `embed{allowed}`),
    `theme` (`{presetId:'amber', brandKitId, overrides}`), `isTemplate`, `templateSourceId`,
    `legacy` (`{source:'poll'|'quiz', sourceId}` or null), `deletedAt` (trash: 404 and hidden
    from lists). Create/update accept `pace`, `settings` (any subset; update patches field by
    field) and `theme.presetId`.
  - Mirror of the live session (written only by `live/session.service.ts`): `status`
    (`draft` never presented → `lobby` / `active` while a session is live → `ended`),
    `currentSlideIndex`, `questionStartedAt`, `questionEndsAt` (the deadline, or the close
    time once closed early; null while untimed), `activeSessionId`, `lastSessionAt`,
    `sessionCount`. `joinCode` (unique 6-digit string) is the deck's for every run.
- **PresentationSession** (`presentationsessions`) — one run of a deck: status, current slide,
  `slideStates`, the deck/settings/theme/entitlement snapshots, and on end the aggregates
  (`participantCount`, `answerCount`, `finalLeaderboard`, `slideStats`) and `retainUntil`.
  Unique partial `{presentationId}` where `isLive` (one live session per deck). Full field
  list: [`presentations-live.md`](./presentations-live.md).
- **PresentationParticipant** — `{ presentationId, sessionId, name, deviceId, token, score, correctCount, kickedAt, locale }`,
  unique partial `(sessionId, deviceId)` → refresh-safe idempotent join within a session.
  `deviceId` comes from a server-signed device token, so clients cannot mint identities.
  `token` is a 48-hex-char secret returned **only to the joiner** (never broadcast); required
  on every answer and on the socket room join.
- **PresentationAnswer** — `{ presentationId, sessionId, participantId, slideId, slideIndex, optionIndex|text|payload, isCorrect, score, timeMs, clientAnswerId, via }`,
  unique partial `(sessionId, slideId, participantId)` — durable backstop against double
  answers — plus `(sessionId, slideId)`.

## Session flow

Summary; the contract is [`presentations-live.md`](./presentations-live.md).

- `open-lobby` ends the live session if any (snapshot included) and opens a **new** session in
  the lobby. Nothing is deleted: every run keeps its participants, answers and snapshot.
- `start` presents without a lobby (content-only decks); `goto` moves to any slide in either
  direction (`advance` = goto current + 1). Revisited slides come back with their stored
  phase and results; leaving an open slide closes it.
- `close` stops answers without revealing; `reopen` re-opens with a fresh timer; `reveal`
  closes and reveals — answers stop at once, also when Redis lost the window (the rebuild
  reads the session's slide state).
- `end` closes the current slide, reconciles Redis into Mongo, writes the snapshot and
  `retainUntil`; Redis state is kept readable for final screens, then expires.
- Joins go to the live session and stop at the plan's `audienceCap` (snapshotted at open):
  403 `SESSION_FULL`.

## Scoring

Server-clock only (`now - openedAt`); clients never report timing. Wrong = 0.
Correct with `scoreDependsOnTime`: `round(points * (1 - ratio/2))` where
`ratio = elapsed/timeLimit` — fastest ≈ full points, slowest ≈ 50% (Kahoot/Mentimeter style).
Answers rejected after `endsAt` + 750ms grace (15 s with a valid slide ticket), and as soon as the
slide is closed or revealed.
Type answers matched case/whitespace-insensitively against `acceptedAnswers`.

Interactive types are never scored: score=0, no correct count, leaderboard unchanged.
The results hash entry carries `scored:false` so `/me` renders "response received".
Payload per type: wordcloud `entries[]` (capped at maxEntries *before* dedupe, one
submission), open_ended `text`, scales `ratings[]` (one per statement, 1..scaleMax), ranking
`ranking[]` (permutation of item indices, Borda-counted: top = n points … last = 1).

## Redis-first hot path

`submitAnswer` never reads Mongo on the happy path; Mongo is batched write-behind. The full
answer path (script steps, grace and tickets, replays, errors, the socket `answer:submit`, the
coalescer and auto-reveal) is in [`presentations-live.md`](./presentations-live.md#answer-path).

Keys are session-scoped and hash-tagged (`psess:{<sid>}:…`, one Cluster slot per session);
the full map is in [`presentations-live.md`](./presentations-live.md#redis-keys). TTL ~6h
after the last transition. Per slide (by slideId): `answered` (SET, dedup + count), `dist` /
`disp` / `feed` (the type's counters: optionIndex/normalized text → count; scales
`s{i}:sum`/`s{i}:count`; ranking itemIndex → Borda points + `voters`; first-seen casing;
newest-first `lpush_trim` entries), `results` (participantId → full answer JSON).

Answer flow in one line: load the window (`:slides[slideId]`) → grade in JS → ONE script call
(auth, rate limit, dedup, window and grace, scores, the type's ops, stored result, dirty mark) →
queue the Mongo write → the window owner schedules the host update. The host sees one
`answer:received` with the distribution per slide per 250 ms (`live/coalescer.ts`), not one per
answer.

Resilience: Redis reads fall back to Mongo and re-hydrate (restart mid-session degrades,
doesn't break; a lost script cache reloads on the next call); `end` reconciles answers the
write-behind lost and replays distributions from Mongo when the Redis counters are incomplete.
Multi-instance safe: state lives in Redis/Mongo; events fan out over Redis pub/sub → Socket.io
(`docs/deploy/multi-instance.md`).

## Security

- **Participant token auth** — answering, `/me`, `/live-state` and the socket room join
  require the join-time secret; a broadcast `participantId` is useless for spoofing.
  Participants removed by the host get 403 `PARTICIPANT_KICKED`.
- **Policy** — creator and host routes run `authenticate()` → `workspaceContext()` →
  `assertCan(req, 'deck:<action>', deck)` (`platform/tenancy.md`). Socket host joins need
  `deck:host` through the user's membership in the deck's workspace (or be its creator for
  decks without one).
- **Rate limiting** (per-IP, sized for classroom NAT): code lookup 60/min plus a global
  5000/min cap against code enumeration, join 500/5min, answer 2000/min, me + live-state
  600/min. On top, every authenticated answer attempt counts against its participant (30 per
  10 s, any channel), and a socket may send 120 `answer:submit` per 10 s.
- Answer keys and speaker notes never leave the server: every participant payload is
  built by the type's allow-list `sanitize` (`toParticipantSlide`), and the pre-reveal
  live distribution only reaches the host.

## Routes (`/api/presentations`)

Also mounted at `/api/quizzes` as a legacy alias (same router, same collection).

Public (participants):
- `GET /code/:code` — resolve join code; while `active` it includes the sanitized current
  slide whatever its lifecycle with its id and phase, plus `questionStartedAt`/`questionEndsAt`
  when it has an answer window (404 while draft)
- `POST /:id/join` — `{ name, deviceToken?, locale? }` → `{ participantId, sessionId, name, score, token, deviceToken }`
- `POST /:id/answer` — `{ participantId, participantToken, slideIndex, sessionId?, slideId?, clientAnswerId?, slideTicket?, offline? }`
  plus either the legacy `optionIndex|text|entries[]|ratings[]|ranking[]` or a generic
  `payload` object (validated by the type's `answerSchema`; wins over legacy fields; errors
  read `payload.<path>: …`). Returns `AnswerResult`; a repeat with the same `clientAnswerId` is a
  replay (`replay: true`, nothing counted twice)
- `GET /:id/me?participantId=&token=` — score/rank; `lastAnswer` once the slide is no longer open
- `GET /:id/live-state?participantId=&token=` — full participant resync

Creator (JWT + workspace context):
- `POST /`, `GET /` (current workspace), `GET /:id`, `PATCH /:id` (draft/ended only), `DELETE /:id`
- Host controls: `GET /:id/host/state`, `POST /:id/host/{open-lobby,start,goto,advance,close,reopen,reveal,end}`,
  `GET /:id/sessions`
- AI drafts: `POST /api/ai/generate-quiz` — `{ topic, slideCount, slideTypes[], tone }` →
  `{ title, slides[] }`, every slide validated against `presentationSlideSchema` (see `modules/ai.md`).

## Realtime

Every state change goes through `live/events.ts` → `publishLiveEvent` (Redis channel
`live:event`) with the session's id on the envelope; each instance delivers `live:event` to
the `live:{presentationId}` rooms and the legacy `quiz:event` copy to `quiz_{presentationId}`
(`answer:received` only to the host rooms). Socket handlers live in `presentations.socket.ts`
(`answer:submit`, `live:resync` included).
See `realtime/presentations.md` for the event contract.

## Tests

- `tests/presentations/registry.golden.test.ts` — characterization of sanitize, accept and
  validation messages, Redis writes, distributions, scoring and request schemas for the seven
  built-in types, written before the registry refactor (in-memory Redis fake + model stubs in
  `tests/presentations/harness.ts`). Changes made by the session engine are marked in place.
- `tests/presentations/routes.test.ts` — route table snapshot (order + middleware count).
- `tests/presentations/registry.test.ts` — registry contract, content lifecycle via a
  test-only type, additive fields, generic payload, `lpush_trim`, exports.
- `tests/presentations/answerPath.test.ts` — replays, grace and tickets, channels and metrics,
  kicked/stale/rate-limited participants, the coalescer, auto-reveal, the end-of-session score
  race, write-behind batches (in-memory Redis whose script is a JS port of `answer.lua`).
- `tests/presentations/ticket.test.ts` — slide ticket HMAC.
- `tests/presentations/sessions.test.ts` — session engine on the fakes: runs, navigation,
  close/reopen/reveal, untimed slides, audience cap, reconciliation, live-state, policy.
- `tests/presentations/content.test.ts` — the eight content types: schema accept/reject
  (script-ish text kept as text, unsafe link/image URLs, strict video ids, upload keys with
  and without storage), the `sanitize` allow-list, labels, `assertContentMediaInWorkspace`,
  and a content-only deck run live (`slide:shown` only).
- `tests/presentations/live.integration.test.ts` — full HTTP lifecycle against real Mongo +
  Redis; skipped unless `TEST_MONGO_URI` and `TEST_REDIS_URL` are set (header has the command).
- `tests/integration/{answerScript,liveScale,multiInstance,metrics}.test.ts` — the answer script
  against a real Redis (and parity with its JS port), socket answers and resync, auto-reveal, the
  score race on real Mongo, two instances with and without the Socket.io adapter, `/metrics`
  (`testing/integration.md`).
- `tests/integration/sessions.test.ts` — sessions through `createApp()` (two runs with
  independent results, navigation, reveal, untimed close, reconciliation, audience cap,
  workspace scoping); `tests/integration/migration-030.test.ts` — migration 030 on fixtures.

## Frontend

`frontend/features/presentations/` (slide registries, builder, live store, stage/host/participant
components; see `frontend/docs/wiki/features/live-surfaces.md`):
- `/polls` — the unified library (`frontend/features/library`), decks under `?type=presentation`;
  sidebar "Create Deck" opens `CreatePresentationModal` (title → manual or AI)
- `/presentation/create` — `PresentationBuilder` shell over `components/builder/`
  (`?id=` edit, `?name=&mode=ai|manual`)
- `/presentation/host/[id]` — `components/host/HostConsole`: lobby with join code + QR to
  `/live/{joinCode}`, timer, live/reveal charts, leaderboard
- `/live` + `/live/[code]` — participant join + `PlayView` (no app shell)

Old `/quiz/*` and `/quizzes` URLs redirect to these (`frontend/next.config.ts`).
