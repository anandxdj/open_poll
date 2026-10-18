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
| `live/answer.service.ts` | `submitAnswer` hot path: window/grace check, auth, dedup, registry `accept`/`score`, one `MULTI` with the type's Redis ops, write-behind. |
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
(`builtInParticipantFields`) and one request base (`builtInSlideSchema`, question
required). Scored types keep a 5–300 s timer; unscored ones (`{ untimed: true }`) also
accept `timeLimit: 0` (untimed: open until the host closes or reveals it).

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
Answers rejected after `endsAt` + 750ms grace, and as soon as the slide is closed or revealed.
Type answers matched case/whitespace-insensitively against `acceptedAnswers`.

Interactive types are never scored: score=0, no correct count, leaderboard unchanged.
The results hash entry carries `scored:false` so `/me` renders "response received".
Payload per type: wordcloud `entries[]` (capped at maxEntries *before* dedupe, one
submission), open_ended `text`, scales `ratings[]` (one per statement, 1..scaleMax), ranking
`ranking[]` (permutation of item indices, Borda-counted: top = n points … last = 1).

## Redis-first hot path

`submitAnswer` never reads Mongo on the happy path; Mongo is async write-behind.

Keys are session-scoped and hash-tagged (`psess:{<sid>}:…`, one Cluster slot per session);
the full map is in [`presentations-live.md`](./presentations-live.md#redis-keys). TTL ~6h
after the last transition. Per slide (by slideId): `answered` (SET, dedup + count), `dist` /
`disp` / `feed` (the type's counters: optionIndex/normalized text → count; scales
`s{i}:sum`/`s{i}:count`; ranking itemIndex → Borda points + `voters`; first-seen casing;
newest-first `lpush_trim` entries), `results` (participantId → full answer JSON).
`buffer:active_presentation_distributions` (SET of deck ids) feeds the live distribution worker.

Answer flow: resolve the live session (`presentation:{pid}:active`, or the client's
`sessionId`) → load the window (`:current` → `:slides[slideId]`) and the participant's token
together → open + grace check → token check → `SADD answered` (dedup) → `answerSchema` +
`accept` + `score` → one `MULTI` for score/correct/type ops/results → `SADD` the buffer set →
publish a light `answer:received` (counts only) → fire-and-forget Mongo writes (the
participant total is incremented only after the answer document is stored).

`liveDistribution.worker.ts` drains the buffer set every 2s and publishes
`answer:received` with the full distribution (`computeSlideDistributionHelper`) to the
host, for `response` slides only, so the host chart updates without a per-answer recompute.

Resilience: Redis reads fall back to Mongo and re-hydrate (restart mid-session degrades,
doesn't break); `end` reconciles answers the write-behind lost and replays distributions
from Mongo when the Redis counters are incomplete. Multi-instance safe: state lives in
Redis/Mongo; events fan out over Redis pub/sub → Socket.io.

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
  600/min.
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
- `POST /:id/answer` — `{ participantId, participantToken, slideIndex, sessionId?, slideId?, clientAnswerId? }`
  plus either the legacy `optionIndex|text|entries[]|ratings[]|ranking[]` or a generic
  `payload` object (validated by the type's `answerSchema`; wins over legacy fields; errors
  read `payload.<path>: …`)
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
(`answer:received` only to the host rooms). Socket handlers live in `presentations.socket.ts`.
See `realtime/presentations.md` for the event contract.

## Tests

- `tests/presentations/registry.golden.test.ts` — characterization of sanitize, accept and
  validation messages, Redis writes, distributions, scoring and request schemas for the seven
  built-in types, written before the registry refactor (in-memory Redis fake + model stubs in
  `tests/presentations/harness.ts`). Changes made by the session engine are marked in place.
- `tests/presentations/routes.test.ts` — route table snapshot (order + middleware count).
- `tests/presentations/registry.test.ts` — registry contract, content lifecycle via a
  test-only type, additive fields, generic payload, `lpush_trim`, exports, worker.
- `tests/presentations/sessions.test.ts` — session engine on the fakes: runs, navigation,
  close/reopen/reveal, untimed slides, audience cap, reconciliation, live-state, policy.
- `tests/presentations/live.integration.test.ts` — full HTTP lifecycle against real Mongo +
  Redis; skipped unless `TEST_MONGO_URI` and `TEST_REDIS_URL` are set (header has the command).
- `tests/integration/sessions.test.ts` — sessions through `createApp()` (two runs with
  independent results, navigation, reveal, untimed close, reconciliation, audience cap,
  workspace scoping); `tests/integration/migration-030.test.ts` — migration 030 on fixtures.

## Frontend

`frontend/features/presentations/` (types, api, hooks, components, slideTypeMeta):
- `/polls` — dashboard "Decks" tab (`PresentationCard`); sidebar "Create Deck" opens
  `CreatePresentationModal` (title → manual or AI)
- `/presentation/create` — `PresentationBuilder` (`?id=` edit, `?name=&mode=ai|manual`)
- `/presentation/host/[id]` — `HostView`: lobby with join code + QR to `/live/{joinCode}`,
  timer, live/reveal charts, leaderboard
- `/live` + `/live/[code]` — participant join + `PlayView` (no app shell)

Old `/quiz/*` and `/quizzes` URLs redirect to these (`frontend/next.config.ts`).
