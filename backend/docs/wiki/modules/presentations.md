---
summary: Live presentation decks (Mentimeter-style) — slide type registry, scored and interactive slides, join codes, speed scoring, leaderboard, Redis-first hot path.
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
> `docs/planning/04-implementation-plan.md`.

## Module layout

| Path | Owns |
|---|---|
| `presentations.service.ts` | **Facade** (`PresentationService` + `publishPresentationEvent`, `computeSlideDistributionHelper`). The stable API for the socket, MCP, AI, worker and controllers; delegates only. |
| `crud.service.ts` | Create/list/update/delete, `getPresentationById`, `assertOwnership`, `isOwner`. |
| `live/session.service.ts` | `openLobby`, `advanceSlide`, `revealCurrentSlide`, `endPresentation`, `getHostState`, `getPresentationByCode`, and the cached **answer window** (`loadAnswerWindow`). |
| `live/answer.service.ts` | `submitAnswer` hot path: window/grace check, auth, dedup, registry `accept`/`score`, one `MULTI` with the type's Redis ops, write-behind. |
| `live/participant.service.ts` | `joinPresentation`, `verifyParticipant`, `isAuthorizedParticipant`, `getParticipantState`. |
| `live/distribution.ts` | `computeSlideDistributionHelper` (registry `distribution`), `getLeaderboard`, `getParticipantCount`. |
| `live/keys.ts` | Redis key map, logical slide targets → keys, TTLs. |
| `live/events.ts` | One publish function per live event; all go through `publishPresentationEvent` → `publishLiveEvent`. |
| `slides/` | Slide type registry (below). |
| `models/{presentation,participant,answer}.model.ts` | Mongoose models; `presentations.model.ts` is the barrel to import from. |
| `presentations.schema.ts` | Request schemas; the slide schema dispatches to the registry. |
| `routes/{participant,crud,host}.route.ts` | Sub-routers composed (in that match order) by `presentations.route.ts`. |
| `controllers/{participant,crud,host}.controller.ts` | Thin HTTP handlers calling the facade. |
| `presentations.socket.ts` | Socket join handlers (see `realtime/presentations.md`). |
| `liveDistribution.worker.ts` | Coalesced host distribution push (`runLiveDistributionTick`). |

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
| `schema` | Zod schema for one slide of this type in create/update requests (defaults included). |
| `sanitize(slide)` | **Explicit allow-list** of participant-facing fields. The registry's `toParticipantSlide` adds `slideIndex`, `totalSlides`, `type`, `kind`, `scored`, `media` (`{url, alt, layout}`, never `key`) and `layout`. Notes and answer keys never leave the server because nothing copies them. |
| `acceptConfig?(slide)` | JSON snapshot cached in the answer window (answer keys, counts, points, `timeLimitMs`). |
| `answerSchema?` | Zod check of the answer payload's structure; config-dependent checks live in `accept`. |
| `accept?(cfg, payload, {elapsedMs})` | Grades one answer → `{isCorrect, ops, persist}`. Throws `ApiError.badRequest` to reject; the dedup marker is rolled back. |
| `score?(cfg, {isCorrect, elapsedMs})` | Points for scored types (`speedScore` in `slides/ops.ts`). |
| `distribution?(slide, {dist, disp, feed})` | Results payload for reveal, host state and the worker. |
| `feedLength?` | Capacity of the per-slide `feed` list; when set, `distribution` receives it. |
| `exportColumns?(slide)` / `exportCells?(slide, answer)` | Per-participant export columns and cells (for session exports). |
| `label(slide)` | Short label for one slide (question, or the type name). |

`RedisOp` (built with `hincrby`, `hsetnx`, `lpushTrim` from `slides/ops.ts`) targets a logical
per-slide structure — `dist` (HASH), `disp` (HASH), `feed` (LIST) — that `live/keys.ts` maps to
the real key; `lpush_trim` keeps the newest `max` entries. `persist` is
`{optionIndex, text, payload}` for the answer document.

Registry API (`slides/registry.ts`): `defineSlideType`, `registerSlideType` (returns a
disposer; duplicate keys throw), `getSlideType`, `requireSlideType` (400 for unknown stored
types), `hasSlideType`, `listSlideTypes`, `isScoredSlideType`, `slideKindOf`,
`toParticipantSlide`. Tests register fixture types and dispose them afterwards.

Built-in types (`kind`/`lifecycle`): `select_answer`, `type_answer` (scored),
`wordcloud`, `open_ended`, `scales`, `ranking` — all `interactive`/`response`;
`leaderboard` — `system`/`system`. They share one flat participant shape
(`builtInParticipantFields`) and one request base (`builtInSlideSchema`, 5–300s timer,
question required).

## Models (`presentations.model.ts` barrel)

- **Presentation** — definition + live session state in one document.
  - `slides[]` subdocument: `type` (validated against the registry at save time, so types
    registered later validate too), `kind` (derived from the registry on default and on
    every validate; not client-settable), `question` (default `''`; required per type),
    `notes` (≤5000, host only), `media` (`{key, url (http/https), alt, layout}` or null),
    `layout` (string or null), `content` / `config` (Mixed, null by default — for registry
    types without flat fields, validated by the type's `schema`; call `markModified` when
    mutating them in place), `timeLimit` (0–300; 0 = untimed, the registry requires ≥5
    wherever an answer window runs). Legacy flat fields of the built-in types stay:
    `options[{text,isCorrect}]` (select, 2–8, at least one correct), `acceptedAnswers[]`
    (type), `maxEntries` 1–3 (wordcloud), `statements[]` + `minLabel`/`maxLabel` +
    `scaleMax` 2–10 (scales), `items[]` 2–10 (ranking), `points` (default 1000),
    `scoreDependsOnTime` (default true). Decks stored before these fields hydrate them
    with defaults (`kind` from the type).
  - Session: `status` `draft → lobby → active → ended`. While `active`, whether the
    current slide is still answering or already revealed is derived from the clock on
    the client, not stored. `currentSlideIndex` (-1 before the first slide),
    `questionStartedAt`, `questionEndsAt` (null on non-`response` slides), `joinCode`
    (unique 6-digit string).
- **PresentationParticipant** — `{ presentationId, name, deviceId, token, score, correctCount }`,
  unique `(presentationId, deviceId)` → refresh-safe idempotent join. `deviceId` comes
  from a server-signed device token, so clients cannot mint identities. `token` is a
  48-hex-char secret returned **only to the joiner** (never broadcast); required on every
  answer and on the socket room join.
- **PresentationAnswer** — `{ presentationId, participantId, slideIndex, optionIndex|text|payload, isCorrect, score, timeMs }`,
  unique `(presentationId, slideIndex, participantId)` — durable backstop against double answers.

## Session flow

- `open-lobby` wipes the previous run (participants, answers, Redis keys) and sets
  `lobby`. Participants holding credentials from the old run must rejoin.
- `advance` moves **forward only** while `active`; going backwards is rejected. The slide's
  registry lifecycle decides the rest (see the registry table).
- `reveal` deletes the cached answer window and broadcasts the distribution. The host view
  calls it automatically when its countdown hits 0. Known gap (pinned by the golden
  tests): the answer path rebuilds a missing window from Mongo while the clock window is
  open, so an early manual reveal does not stop answers before `questionEndsAt` + grace.
- `end` sets `ended`; Redis state is kept readable for final screens, then expires.

## Scoring

Server-clock only (`now - questionStartedAt`); clients never report timing. Wrong = 0.
Correct with `scoreDependsOnTime`: `round(points * (1 - ratio/2))` where
`ratio = elapsed/timeLimit` — fastest ≈ full points, slowest ≈ 50% (Kahoot/Mentimeter style).
Answers rejected after `questionEndsAt` + 750ms grace.
Type answers matched case/whitespace-insensitively against `acceptedAnswers`.

Interactive types are never scored: score=0, no correct count, leaderboard unchanged.
The results hash entry carries `scored:false` so `/me` renders "response received".
Payload per type: wordcloud `entries[]` (capped at maxEntries *before* dedupe, one
submission), open_ended `text`, scales `ratings[]` (one per statement, 1..scaleMax), ranking
`ranking[]` (permutation of item indices, Borda-counted: top = n points … last = 1).

## Redis-first hot path

`submitAnswer` never reads Mongo on the happy path; Mongo is async write-behind.

Key map (TTL ~6h after the last transition; wiped on `open-lobby`):

| Key | Type | Purpose |
|---|---|---|
| `presentation:{id}:session` | STRING (JSON) | Answer window `{v:2, slideIndex, type, scored, startedAtMs, endsAtMs, cfg}` (`cfg` = the type's `acceptConfig`). Set on advance to a `response` slide, **deleted on reveal**; other formats are rebuilt from Mongo. |
| `presentation:{id}:scores` | ZSET | participantId → cumulative score; leaderboard = `ZRANGE REV`. |
| `presentation:{id}:correct` | HASH | participantId → correct-answer count. |
| `presentation:{id}:names` | HASH | participantId → nickname (also participant count via `HLEN`). |
| `presentation:{id}:tokens` | HASH | participantId → secret token (answer auth without Mongo). |
| `presentation:{id}:answered:{slide}` | SET | `SADD` = atomic dedup; `SCARD` = live answered count. |
| `presentation:{id}:dist:{slide}` | HASH | optionIndex/normalized text → count; scales `s{i}:sum`/`s{i}:count`; ranking itemIndex → Borda points + `voters`. |
| `presentation:{id}:disp:{slide}` | HASH | normalized text → first-seen original casing (wordcloud / open_ended). |
| `presentation:{id}:feed:{slide}` | LIST | newest-first raw entries from `lpush_trim` ops (types with `feedLength`; unused by the built-ins). |
| `presentation:{id}:results:{slide}` | HASH | participantId → `{isCorrect, score, scored}` for `/me`. |
| `buffer:active_presentation_distributions` | SET | decks with fresh answers, drained by the live distribution worker. |

Answer flow: load window → grace check → token check → `SADD answered` (dedup) →
`answerSchema` + `accept` + `score` → one `MULTI` for score/correct/type ops/results →
`SADD` the buffer set → publish a light `answer:received` (counts only) → fire-and-forget
Mongo writes.

`liveDistribution.worker.ts` drains the buffer set every 2s and publishes
`answer:received` with the full distribution (`computeSlideDistributionHelper`) to the
host, for `response` slides only, so the host chart updates without a per-answer recompute.

Resilience: Redis reads fall back to Mongo and re-hydrate (restart mid-session degrades,
doesn't break). Multi-instance safe: state lives in Redis/Mongo; events fan out over
Redis pub/sub → Socket.io.

## Security

- **Participant token auth** — answering, `/me` and the socket room join require the
  join-time secret; a broadcast `participantId` is useless for spoofing.
- **Host socket auth** — `quiz:join` / `live:join` as host requires a JWT whose user owns the deck.
- **Rate limiting** (per-IP, sized for classroom NAT): code lookup 60/min plus a global
  5000/min cap against code enumeration, join 500/5min, answer 2000/min, me 600/min.
- Answer keys and speaker notes never leave the server: every participant payload is
  built by the type's allow-list `sanitize` (`toParticipantSlide`), and the pre-reveal
  live distribution only reaches the host.

## Routes (`/api/presentations`)

Also mounted at `/api/quizzes` as a legacy alias (same router, same collection).

Public (participants):
- `GET /code/:code` — resolve join code; while `active` it includes the sanitized current
  slide whatever its lifecycle, plus `questionStartedAt`/`questionEndsAt` when it has an
  answer window (404 while draft)
- `POST /:id/join` — `{ name, deviceToken? }` → `{ participantId, name, score, token, deviceToken }`
- `POST /:id/answer` — `{ participantId, participantToken, slideIndex }` plus either the legacy
  `optionIndex|text|entries[]|ratings[]|ranking[]` or a generic `payload` object (validated by
  the type's `answerSchema`; wins over legacy fields; errors read `payload.<path>: …`)
- `GET /:id/me?participantId=&token=` — score/rank; `lastAnswer` only after the window closes

Creator (JWT):
- `POST /`, `GET /`, `GET /:id`, `PATCH /:id` (draft/ended only), `DELETE /:id`
- Host controls: `GET /:id/host/state`, `POST /:id/host/open-lobby`, `POST /:id/host/advance`
  (`{ slideIndex? }`), `POST /:id/host/reveal`, `POST /:id/host/end`
- AI drafts: `POST /api/ai/generate-quiz` — `{ topic, slideCount, slideTypes[], tone }` →
  `{ title, slides[] }`, every slide validated against `presentationSlideSchema` (see `modules/ai.md`).

## Realtime

Every state change goes through `live/events.ts` → `publishLiveEvent` (Redis channel
`live:event`); each instance delivers `live:event` to the `live:{presentationId}` rooms and the
legacy `quiz:event` copy to `quiz_{presentationId}` (`answer:received` only to the host rooms).
`slide:shown` (`{slideIndex, slide, isLastSlide, serverNow}`, audience `all`) is published for
`content`/`board` slides; it is not yet declared in `common/realtime/events/presentation.ts`, so
it takes the default `all` audience. Socket handlers live in `presentations.socket.ts`. See
`realtime/presentations.md` for the event contract.

## Tests

- `tests/presentations/registry.golden.test.ts` — characterization of sanitize, accept and
  validation messages, Redis writes, distributions, scoring and request schemas for the seven
  built-in types, written before the registry refactor (in-memory Redis fake + model stubs in
  `tests/presentations/harness.ts`).
- `tests/presentations/routes.test.ts` — route table snapshot (order + middleware count).
- `tests/presentations/registry.test.ts` — registry contract, content lifecycle via a
  test-only type, additive fields, generic payload, `lpush_trim`, exports, worker.
- `tests/presentations/live.integration.test.ts` — full HTTP lifecycle against real Mongo +
  Redis; skipped unless `TEST_MONGO_URI` and `TEST_REDIS_URL` are set (header has the command).

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
