---
summary: Live session engine contract — sessions, slide phases, host commands, participant resync, events, Redis keys, error codes.
status: active
last_updated: 2026-10-19
---

# Presentations live sessions (contract)

Types: `backend/src/modules/presentations/live/contract.ts` (mirror them in the frontend's
`features/presentations/types/{live,realtime}.ts`). Module layout and slide registry:
[`presentations.md`](./presentations.md). Envelope, rooms and delivery:
[`../realtime/envelope.md`](../realtime/envelope.md).

## Model

Every time a deck is presented it gets a **session** (`PresentationSession`, collection
`presentationsessions`). Sessions are never deleted by presenting again: each keeps its
participants, answers, scores and a final snapshot. At most one session per deck is **live**
(`isLive: true`, status `lobby` or `active`); a unique partial index enforces it.

| Session field | Meaning |
| --- | --- |
| `runNumber` | 1, 2, 3, … per deck (`presentation.sessionCount` after open) |
| `status` | `lobby` → `active` → `ended`; `isLive` while not `ended` |
| `pace` | `presenter` (one slide open at a time); `audience` (W2-F) |
| `joinCode` | The deck's join code at open (codes are per deck and stable across runs) |
| `currentSlideId`, `currentSlideIndex` | -1 / null in the lobby |
| `slideStates` | slideId → `{openedAt, endsAt, pausedRemainingMs, closedAt, revealedAt}` for every visited slide |
| `deckSnapshot`, `settingsSnapshot`, `themeSnapshot`, `entitlementsSnapshot` | Frozen at open; the engine runs from `deckSnapshot`, so slide ids and answer keys never shift under a session |
| `participantCount`, `answerCount`, `finalLeaderboard` (≤100), `slideStats[]` | Written by `end` |
| `retainUntil` | `endedAt` + workspace retention (setting capped by the plan); null = no limit |
| `share` | Reserved for result sharing (W2-C) |

The deck keeps a **mirror** of its live session — `status` (`draft` before the first run, `ended`
between runs), `currentSlideIndex`, `questionStartedAt`, `questionEndsAt`, `activeSessionId`,
`lastSessionAt`, `sessionCount`. Only `live/session.service.ts` writes them. Deck edits stay
blocked while a session is live.

Participants and answers carry `sessionId`; answers also carry `slideId` (plus `slideIndex` for
exports), `clientAnswerId` and `via` (`rest` today; `socket`/`offline` from W2-D). A participant
belongs to one session: a device that joins a later session becomes a new participant there.

## Slide phases

| Lifecycle (registry) | Phases |
| --- | --- |
| `content`, `board`, `system` | `shown` |
| `response` | `open` → `closed` → `revealed` (`reopen` goes back to `open`) |

- **Timed** response slides (`timeLimit` > 0) close by the clock: answers are refused after
  `endsAt` + 750 ms grace, and views report `closed` once `endsAt` has passed.
- **Untimed** slides (`timeLimit: 0`, allowed for unscored types; scored types need ≥ 5 s) have
  `endsAt: null` and stay `open` until the host closes, reveals or leaves the slide.
- `reveal` closes the slide first: **no answer is accepted after a reveal**, even before `endsAt`.
- Leaving an open slide (goto elsewhere) closes it.
- Revisiting a slide never reopens it: it comes back in its stored phase with its stored results.

## Host commands

All under `/api/presentations` (also `/api/quizzes`), `authenticate()` + `workspaceContext()`,
policy `deck:host` (`assertCan`; decks without `workspaceId` — before migration 020 — fall back to
the creator). Each returns `HostCommandResponse` = the deck document **plus `session: SessionView`**
(`session.current` describes the current slide, including its phase and answered count).

| Command | Body | Effect | Events |
| --- | --- | --- | --- |
| `POST /:id/host/open-lobby` | — | Ends the live session if any (with a snapshot), opens a **new** session in `lobby`. Never deletes data. | `session:lobby`, `lobby:opened` |
| `POST /:id/host/start` | — | Present without a lobby: lobby session → goes to slide 0; no live session → new session straight to slide 0. 409 `SESSION_ALREADY_LIVE` while a session is `active`. | slide 0's event (below) |
| `POST /:id/host/goto` | `{slideIndex}` or `{slideId}` | Moves to any slide, forwards or backwards (from `lobby` too). | the target's event |
| `POST /:id/host/advance` | `{slideIndex?}` | Legacy alias: `goto` `slideIndex`, default current + 1. | the target's event |
| `POST /:id/host/close` | — | Stops answers on the current response slide (no reveal). No-op if already closed. | `slide:closed` |
| `POST /:id/host/reopen` | — | Re-opens the current closed/revealed response slide with a fresh timer (`timeLimit`, or untimed). Earlier answers stay; those participants cannot answer again. | `question:started` (`reopened: true`) |
| `POST /:id/host/reveal` | — | Closes (if open) and reveals the current response slide. Repeatable (re-broadcast). | `question:revealed` |
| `POST /:id/host/end` | — | Ends the live session: snapshot, reconciliation, `retainUntil`. Idempotent once ended. | `session:ended`, `quiz:ended` |

Event on arriving at a slide (`goto`, `start`, `advance`):

| Target | Event |
| --- | --- |
| content / board slide | `slide:shown` |
| system (leaderboard) slide | `leaderboard:shown` |
| response slide, first visit | `question:started` (opens the answer window) |
| response slide, revisited after a reveal | `question:revealed` (`revisit: true`, stored results) |
| response slide, revisited while closed | `slide:closed` (`revisit: true`) |

`goto` to the slide already current is a no-op (no event).

### Reads

| Route | Policy | Response |
| --- | --- | --- |
| `GET /:id/host/state` | `deck:host` | `HostStateResponse`: the legacy fields (`quiz`, `presentation`, `serverNow`, `participants`, `answeredCount`, `liveDistribution`, `leaderboard`) for `session`, plus `session` (live, else latest ended, else null), `slideStates` (visited slides) and `distributions` (slideId → results of every visited response slide). After `end` the results come from the stored snapshot. |
| `GET /:id/sessions` | `session:read` | `SessionListItem[]`, newest first. |

## Participant API (public)

| Route | Rate limit (per IP) | Notes |
| --- | --- | --- |
| `GET /code/:code` | 60/min + 5000/min global | Adds `sessionId`, `pace`, `currentSlideId`, `currentSlidePhase`. `questionEndsAt` is null for an untimed open slide; after an early close/reveal it is the close time. |
| `POST /:id/join` | 500 / 5 min | `{name, deviceToken?, locale?}` → `JoinResponse` (adds `sessionId`). Joins the **live** session. 403 `SESSION_FULL` when the session already has `audienceCap` participants (a rejoin with the same `deviceToken` always succeeds). 403 `PARTICIPANT_KICKED` for removed participants. |
| `POST /:id/answer` | 2000/min | Unchanged body plus optional `sessionId`, `slideId`, `clientAnswerId` (≤ 64 chars). `slideIndex` stays required and must match the slide. 409 `PARTICIPANT_STALE` when the participant belongs to an ended session. |
| `GET /:id/me?participantId&token` | 600/min | Adds `sessionId`; `lastAnswer` (with `slideId`) once the current slide is no longer `open`. |
| `GET /:id/live-state?participantId&token` | 600/min | `ParticipantLiveState`: session status, settings, theme, current slide (sanitized) with phase and timing, results when revealed, leaderboard on system slides, the participant's own standing, final standings once ended. Use it to resync after any reconnect or `seq` gap. |

Participant credentials are per session. Clients should key stored credentials by session
(`openpoll_participant_{code}_{sessionId}`) and rejoin when `live-state`/`me` answers 404 or the
code lookup shows a different `sessionId`.

## Events

Envelope v1 with `sessionId` set (see `realtime/envelope.md`). Payload types:
`PresentationEventPayloads`. All carry `slideId` where a slide is concerned.

| Type | Audience | When |
| --- | --- | --- |
| `session:lobby` | all | `open-lobby` — `{runNumber, joinCode, pace}` |
| `lobby:opened` | all | legacy copy, right after `session:lobby` — `{joinCode}` |
| `participant:joined` | all | join — `{participantId, name, participantCount}` |
| `question:started` | all | response slide opened — `{slideId, slideIndex, slide, startedAt, endsAt \| null, serverNow, isLastSlide, reopened}` |
| `slide:shown` | all | content/board slide — `{slideId, slideIndex, slide, isLastSlide, serverNow}` |
| `slide:closed` | all | close, or revisit of a closed slide — `{slideId, slideIndex, slide, closedAt, answeredCount, participantCount, isLastSlide, revisit, serverNow}` |
| `answer:received` | host only | per answer `{slideId, slideIndex, answeredCount}`; the 2 s worker adds `participantCount` + `distribution` |
| `question:revealed` | all | reveal, or revisit of a revealed slide — legacy fields + `{slideId, slide, revealedAt, revisit}` |
| `leaderboard:shown` | all | system slide — `{slideId, slideIndex, slide, leaderboard, participantCount, isLastSlide}` |
| `session:ended` | all | end — `{runNumber, endedAt, leaderboard (≤100), participantCount, answerCount}` |
| `quiz:ended` | all | legacy copy, right after `session:ended` — `{leaderboard, participantCount}` |

Clients ignore events whose `sessionId` is not their session's. `showResultsOnDevices` and
`quiz.showCorrectOnDevices` are presentation choices applied by the participant UI; results are
not secret once revealed.

## Ending a session

`end` (and `open-lobby` replacing a live session) closes the current slide and writes the snapshot:

1. **Reconciliation** — answers live in Redis first and reach Mongo by write-behind. For every
   visited response slide, answers present in `psess:{sid}:results:{slideId}` (full answer JSON)
   but missing in Mongo are inserted; participants' `score`/`correctCount` are set from the Redis
   totals.
2. `slideStats[]` (per visited response slide: `answeredCount` + the type's `distribution`),
   `finalLeaderboard` (top 100), `participantCount`, `answerCount`.
3. `retainUntil` from the deck's workspace (`settings.retentionDays` capped by the plan's
   `retentionDays`; decks without a workspace use the free plan).
4. Redis keys stay readable for final screens (TTL refreshed), `presentation:{pid}:active` is
   removed, and the deck mirror becomes `ended`.

## Redis keys

Session-scoped and hash-tagged, so one session's keys share a Cluster slot (Lua-safe):

| Key | Type | Content |
| --- | --- | --- |
| `presentation:{pid}:active` | STRING | live session id |
| `psess:{<sid>}:meta` | HASH | `presentationId`, `pace`, `status`, `cap` (`''` = unlimited), `runNumber`, `totalSlides` |
| `psess:{<sid>}:current` | STRING | current slideId (presenter pace) |
| `psess:{<sid>}:slides` | HASH | slideId → answer window JSON `{v, slideId, slideIndex, type, scored, open, startedAtMs, endsAtMs \| null, pausedRemainingMs, cfg}` |
| `psess:{<sid>}:scores` / `:correct` / `:names` / `:tokens` | ZSET / HASH | standings, correct counts, nicknames, participant secrets |
| `psess:{<sid>}:seats` | SET | deviceIds holding a seat (audience cap; SADD-then-SCARD never over-admits) |
| `psess:{<sid>}:kicked` | SET | removed participantIds |
| `psess:{<sid>}:answered:{slideId}` | SET | dedup + answered count |
| `psess:{<sid>}:dist:{slideId}` / `:disp:{slideId}` / `:feed:{slideId}` | HASH / HASH / LIST | the slide type's counters |
| `psess:{<sid>}:results:{slideId}` | HASH | participantId → full answer JSON (`/me` results and reconciliation) |
| `live:{pid}:seq` | STRING | envelope seq (unchanged) |

TTL 6 h after the last transition. A missing window is rebuilt from the session document
(`slideStates`), so a Redis restart cannot reopen a closed or revealed slide.

## Error codes

`SESSION_FULL` (403, join), `SESSION_ALREADY_LIVE` (409, start), `SESSION_BUSY` (409, concurrent
host commands — retry), `NO_LIVE_SESSION` (400, host commands that need one),
`PARTICIPANT_KICKED` (403), `PARTICIPANT_STALE` (409, answer from an ended session's participant),
`FORBIDDEN` (403, policy), `WORKSPACE_FORBIDDEN` (403, bad `X-Workspace-Id`). Messages are for humans.

## Behaviour changes from the single-run engine

- Opening the lobby again no longer wipes the previous run; it starts session N+1.
- Navigation works in both directions; revisits show stored results.
- Reveal stops answers immediately (previously answers were accepted until `endsAt` + grace).
- Unscored built-in types may be untimed (`timeLimit: 0`).
- Host and edit routes use the workspace policy; `GET /api/presentations` lists the current
  workspace's decks (plus the caller's own decks not yet assigned to a workspace when the current
  workspace is their personal one), most recently updated first.

## Notes for later packages

- **W1-A2**: no auto-open on mount — read `host/state`; `session` null or ended → "Start
  presenting" (`start`) / "Open lobby"; back/forward = `goto`; untimed slides need "Close voting"
  (`close`); participants resync with `live-state`.
- **W2-A** (`timing.service`): `slideStates.pausedRemainingMs` and the window's
  `pausedRemainingMs` are reserved for pause/resume; `close`/`reopen` already exist for remotes.
- **W2-C**: `slideStats`, `finalLeaderboard`, `retainUntil`, `share` are on the session;
  answers are keyed by `{sessionId, slideId, participantId}`.
- **W2-D**: the answer path reads `:current` and `:slides`; `clientAnswerId` and `via` are stored;
  `psess:{sid}:results` holds what reconciliation needs.
- **W2-F**: `pace: 'audience'` opens every response slide in `:slides`; `settings.audiencePaced`
  is snapshotted.
